/**
 * Payment flow — the money path.
 *
 * The client may only ever name a plan and a discount code. Every number is
 * computed server-side (`services/pricing.ts`), stored on the `payments` row,
 * and re-asserted against what the gateway says it charged. The four routes:
 *
 *   POST /payments/quote      price preview + discount validation (authed)
 *   POST /payments/checkout   create payment, register with PSP, hand back URL (authed)
 *   GET  /payments/callback   the PSP redirects the user's browser here (public)
 *   GET  /payments/:id        status poll for the app after returning (authed)
 *
 * Idempotency is structural: `payments.applied_at` is claimed with
 * `UPDATE … WHERE applied_at IS NULL RETURNING`, so however many times the
 * callback fires (Zibal retries, user refreshes the result page), the grant
 * happens exactly once.
 */
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { payments } from "../db/schema.js";
import { toLocalPhone } from "../lib/phone.js";
import { requireUser } from "../plugins/auth.js";
import { badRequest, notFound, tooMany } from "../plugins/errors.js";
import { ZIBAL_RESULT, ZIBAL_STATUS } from "../providers/psp/index.js";
import { grantInterval, readEntitlement } from "../services/entitlement.js";
import { checkDiscount, quote, redeemDiscount } from "../services/pricing.js";

const quoteBody = z.object({
  planId: z.string().min(1).max(32),
  code: z.string().max(64).optional(),
});

const checkoutBody = quoteBody.extend({
  platform: z.enum(["web", "android", "ios"]).optional(),
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A user may not stockpile unbounded pending payments — each one is a PSP
 * round-trip and a DB row. Ten an hour is far beyond any honest retry. */
const MAX_CHECKOUTS_PER_HOUR = 10;

type PaymentRow = typeof payments.$inferSelect;

export const paymentRoutes: FastifyPluginAsync = async (app) => {
  const { db, env, psp } = app.deps;
  const now = () => new Date(app.deps.now());

  /** Applies a verified-paid payment exactly once (claim → grant → redeem).
   * If granting fails after the claim, the claim is rolled back so a later
   * callback/refresh can retry — the user has paid; losing the grant is the one
   * unacceptable outcome. */
  async function applyPaid(
    p: PaymentRow,
    v: { refNumber?: string; cardNumber?: string; result?: number; status?: number },
    t: Date,
  ): Promise<void> {
    const claimed = await db
      .update(payments)
      .set({
        status: "paid",
        refNumber: v.refNumber ?? p.refNumber,
        cardNumber: v.cardNumber ?? p.cardNumber,
        pspResult: v.result ?? p.pspResult,
        pspStatus: v.status ?? p.pspStatus,
        paidAt: p.paidAt ?? t,
        verifiedAt: t,
        appliedAt: t,
        updatedAt: t,
      })
      .where(and(eq(payments.id, p.id), isNull(payments.appliedAt)))
      .returning();
    if (!claimed.length) return; // another callback already applied it

    try {
      await grantInterval(
        db,
        p.userId,
        { planId: p.planId, months: p.months, source: "payment", paymentId: p.id },
        t,
      );
      if (p.discountCode) await redeemDiscount(db, p.discountCode, p.userId, p.id);
    } catch (err) {
      // Un-claim so the next callback or status poll can retry the grant.
      await db.update(payments).set({ appliedAt: null, updatedAt: t }).where(eq(payments.id, p.id));
      throw err;
    }
  }

  /** Price preview. Invalid codes come back as a reason, not an error — the UI
   * shows "کد منقضی شده" instead of a failed request. */
  app.post("/payments/quote", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const body = quoteBody.parse(req.body);
    const t = now();
    const q = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);
    const d = await checkDiscount(db, body.code ?? null, user.id, user.phone, t);
    return { quote: q, discount: d };
  });

  app.post("/payments/checkout", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const body = checkoutBody.parse(req.body);
    const t = now();

    const since = new Date(t.getTime() - 3_600_000);
    const [recent] = await db
      .select({ n: count() })
      .from(payments)
      .where(and(eq(payments.userId, user.id), gt(payments.createdAt, since)));
    if ((recent?.n ?? 0) >= MAX_CHECKOUTS_PER_HOUR) {
      throw tooMany("Too many payment attempts. Try again later.", 3600);
    }

    const q = await quote(db, body.planId, body.code ?? null, user.id, user.phone, t, 0, true);

    const [payment] = await db
      .insert(payments)
      .values({
        userId: user.id,
        planId: q.planId,
        months: q.months,
        amountToman: q.finalToman,
        amountRial: q.finalRial,
        discountCode: q.discountCode,
        discountPercent: q.discountPercent,
        offerPercent: q.offerPercent,
        platform: body.platform ?? "web",
        status: "pending",
        createdAt: t,
        updatedAt: t,
      })
      .returning();
    if (!payment) throw new Error("failed to create payment");

    // 100% discount: nothing to charge, so nothing goes near the gateway.
    // Grant directly through the same applied_at guard as a real payment.
    if (q.finalToman <= 0) {
      await applyPaid(payment, { refNumber: "FREE", result: 0, status: 0 }, t);
      return {
        free: true,
        paymentId: payment.id,
        entitlement: await readEntitlement(db, user.id, t),
      };
    }

    const res = await psp.request({
      amountRial: q.finalRial,
      callbackUrl: `${env.PUBLIC_API_URL}/v1/payments/callback`,
      orderId: payment.id,
      description: `Routino ${q.planId} (${q.months}m)`,
      mobile: toLocalPhone(user.phone),
    });

    if (!res.ok || !res.trackId) {
      await db
        .update(payments)
        .set({ status: "failed", pspResult: res.result, updatedAt: t })
        .where(eq(payments.id, payment.id));
      req.log.error({ paymentId: payment.id, result: res.result }, "psp request failed");
      throw badRequest("psp_failed", "Payment gateway rejected the request. Try again.");
    }

    await db
      .update(payments)
      .set({ status: "redirected", trackId: res.trackId, updatedAt: t })
      .where(eq(payments.id, payment.id));

    return {
      free: false,
      paymentId: payment.id,
      trackId: res.trackId,
      paymentUrl: psp.startUrl(res.trackId),
      amountToman: q.finalToman,
    };
  });

  /**
   * The PSP redirects the user's browser here after the gateway.
   *
   * Zibal sends `?trackId=…&success=1|0&status=…&orderId=…`. This handler must
   * be idempotent and safe against a forged query string: `success=1` from the
   * URL is never trusted — only `psp.verify()` (a server-to-server call) can
   * mark a payment paid, and the verified amount must equal what we charged.
   */
  app.get("/payments/callback", async (req, reply) => {
    const qs = req.query as Record<string, string | undefined>;
    const trackId = Number(qs.trackId);
    const t = now();

    let payment: PaymentRow | undefined;
    if (Number.isSafeInteger(trackId) && trackId > 0) {
      [payment] = await db.select().from(payments).where(eq(payments.trackId, trackId)).limit(1);
    }
    if (!payment && qs.orderId && UUID_RE.test(qs.orderId)) {
      [payment] = await db.select().from(payments).where(eq(payments.id, qs.orderId)).limit(1);
    }

    if (!payment) {
      return sendResultPage(reply, env, { outcome: "failed", message: "پرداخت پیدا نشد." });
    }

    // Already granted (double callback / refresh): render the final state.
    if (payment.appliedAt) {
      return sendResultPage(reply, env, { outcome: "paid", payment });
    }

    // The user canceled at the gateway. Verify would also tell us, but skipping
    // the round-trip for the common cancel case keeps the page fast.
    if (qs.success !== "1") {
      await db
        .update(payments)
        .set({ status: "canceled", pspStatus: Number(qs.status) || null, updatedAt: t })
        .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
      return sendResultPage(reply, env, { outcome: "canceled", payment });
    }

    // From here on, `success=1` in the query string is a CLAIM, nothing more —
    // anyone can type that URL. Even a payment previously marked failed or
    // canceled is re-verified: a stale local status must never beat the
    // gateway's server-to-server answer, or a paid user loses their grant.
    let v;
    try {
      v = await psp.verify(payment.trackId ?? trackId);
    } catch (err) {
      req.log.error({ err, paymentId: payment.id }, "psp verify unreachable");
      // Do NOT mark failed: the money may have moved. Leave the row as-is; the
      // status poll and the next callback can retry verification.
      return sendResultPage(reply, env, { outcome: "pending", payment });
    }

    if (v.result === ZIBAL_RESULT.OK && v.status === ZIBAL_STATUS.PAID_VERIFIED) {
      if (typeof v.amount === "number" && v.amount !== payment.amountRial) {
        // The single scariest branch in the codebase: gateway says an amount we
        // never asked for. Never grant; flag loudly.
        await db
          .update(payments)
          .set({ status: "verify_failed", pspResult: v.result, pspStatus: v.status, updatedAt: t })
          .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
        req.log.error(
          { paymentId: payment.id, expectedRial: payment.amountRial, gotRial: v.amount },
          "PAYMENT AMOUNT MISMATCH — investigate immediately",
        );
        return sendResultPage(reply, env, { outcome: "verify_failed", payment });
      }
      await applyPaid(payment, v, t);
      const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      return sendResultPage(reply, env, { outcome: "paid", payment: fresh ?? payment });
    }

    if (v.result === ZIBAL_RESULT.ALREADY_VERIFIED) {
      // Verified in a previous callback we never finished processing. Zibal's
      // 201 carries no amount, but the amount was asserted the first time; the
      // applied_at guard makes re-applying safe.
      await applyPaid(payment, v, t);
      const [fresh] = await db.select().from(payments).where(eq(payments.id, payment.id)).limit(1);
      return sendResultPage(reply, env, { outcome: "paid", payment: fresh ?? payment });
    }

    if (v.status === ZIBAL_STATUS.PENDING) {
      // Not settled at the gateway yet (or a premature/forged callback). Leave
      // the row untouched so the real outcome can still land later.
      return sendResultPage(reply, env, { outcome: "pending", payment });
    }

    const canceled = v.status === ZIBAL_STATUS.CANCELED_BY_USER;
    await db
      .update(payments)
      .set({
        status: canceled ? "canceled" : "failed",
        pspResult: v.result,
        pspStatus: v.status ?? null,
        updatedAt: t,
      })
      .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
    return sendResultPage(reply, env, { outcome: canceled ? "canceled" : "failed", payment });
  });

  /** Status poll for the app. Also the recovery path: a payment stuck in
   * `redirected` (callback never landed) gets re-verified here. */
  app.get("/payments/:id", { preHandler: app.authenticate }, async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    if (!UUID_RE.test(id)) throw badRequest("bad_id", "Malformed payment id");

    let [payment] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.id, id), eq(payments.userId, user.id)))
      .limit(1);
    if (!payment) throw notFound("unknown_payment", "No such payment");

    // Self-heal: user returned but the callback never fired (network, closed
    // tab). One verify round-trip settles it.
    if (payment.status === "redirected" && payment.trackId) {
      const t = now();
      try {
        const v = await psp.verify(payment.trackId);
        if (
          (v.result === ZIBAL_RESULT.OK && v.status === ZIBAL_STATUS.PAID_VERIFIED) ||
          v.result === ZIBAL_RESULT.ALREADY_VERIFIED
        ) {
          if (v.result === ZIBAL_RESULT.OK && typeof v.amount === "number" && v.amount !== payment.amountRial) {
            await db
              .update(payments)
              .set({ status: "verify_failed", pspResult: v.result, pspStatus: v.status ?? null, updatedAt: t })
              .where(eq(payments.id, payment.id));
            req.log.error(
              { paymentId: payment.id, expectedRial: payment.amountRial, gotRial: v.amount },
              "PAYMENT AMOUNT MISMATCH — investigate immediately",
            );
          } else {
            await applyPaid(payment, v, t);
          }
        } else if (v.status === ZIBAL_STATUS.CANCELED_BY_USER) {
          await db
            .update(payments)
            .set({ status: "canceled", pspResult: v.result, pspStatus: v.status ?? null, updatedAt: t })
            .where(and(eq(payments.id, payment.id), isNull(payments.appliedAt)));
        }
        [payment] = await db
          .select()
          .from(payments)
          .where(eq(payments.id, id))
          .limit(1);
      } catch {
        /* verify unreachable — report current state; the client will poll again */
      }
    }
    if (!payment) throw notFound("unknown_payment", "No such payment");

    return {
      payment: {
        id: payment.id,
        status: payment.status,
        planId: payment.planId,
        months: payment.months,
        amountToman: payment.amountToman,
        discountCode: payment.discountCode,
        refNumber: payment.refNumber,
        paidAt: payment.paidAt,
        createdAt: payment.createdAt,
      },
      entitlement: await readEntitlement(db, user.id, now()),
    };
  });
};

/* ---------------- the browser-facing result page ---------------- */

interface ResultPageInput {
  outcome: "paid" | "canceled" | "failed" | "verify_failed" | "pending";
  payment?: PaymentRow;
  message?: string;
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Rendered to the user's browser after the gateway. Not part of the SPA — the
 * user may land here with the app closed. Its one job: state the outcome and
 * get the user back into the app (web URL, or deep link on Android/iOS).
 */
function sendResultPage(
  reply: { type: (t: string) => { send: (b: string) => unknown } },
  env: { PUBLIC_WEB_URL: string; APP_DEEP_LINK: string },
  input: ResultPageInput,
): unknown {
  const { outcome, payment } = input;
  const native = payment?.platform === "android" || payment?.platform === "ios";
  const params = payment ? `paymentId=${payment.id}&status=${outcome}` : `status=${outcome}`;
  const webUrl = `${env.PUBLIC_WEB_URL}/pay/result?${params}`;
  const deepLink = `${env.APP_DEEP_LINK}?${params}`;
  const target = native ? deepLink : webUrl;

  const ok = outcome === "paid";
  const title = ok
    ? "پرداخت موفق بود 🎉"
    : outcome === "canceled"
      ? "پرداخت لغو شد"
      : outcome === "pending"
        ? "در حال بررسی پرداخت…"
        : "پرداخت ناموفق بود";
  const detail =
    input.message ??
    (ok
      ? `اشتراک شما فعال شد.${payment?.refNumber ? ` کد پیگیری: ${esc(payment.refNumber)}` : ""}`
      : outcome === "canceled"
        ? "مبلغی از حساب شما کم نشده. اگر منصرف شدی مشکلی نیست — هر وقت خواستی دوباره تلاش کن."
        : outcome === "verify_failed"
          ? `تأیید پرداخت با مشکل روبه‌رو شد. اگر مبلغی کم شده، تا ۷۲ ساعت آینده به حسابت برمی‌گردد. کد پیگیری: ${payment ? esc(payment.id.slice(0, 8)) : "-"}`
          : outcome === "pending"
            ? "نتیجه هنوز از درگاه نرسیده. چند لحظه دیگر در برنامه وضعیت را ببین."
            : "پرداخت انجام نشد. اگر مبلغی کم شده، تا ۷۲ ساعت آینده برمی‌گردد.");

  const html = `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>روتینو — نتیجه پرداخت</title>
<style>
  body{margin:0;font-family:Vazirmatn,Tahoma,sans-serif;background:#f8f7f4;color:#1c1917;
       min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:24px;padding:40px 32px;max-width:360px;width:calc(100% - 48px);
        text-align:center;box-shadow:0 8px 30px rgba(0,0,0,.06)}
  .icon{font-size:56px;line-height:1;margin-bottom:16px}
  h1{font-size:20px;margin:0 0 10px}
  p{font-size:14px;color:#57534e;line-height:1.9;margin:0 0 24px}
  a.btn{display:block;background:${ok ? "#f97316" : "#78716c"};color:#fff;text-decoration:none;
        border-radius:14px;padding:14px;font-weight:700;font-size:15px}
  a.alt{display:block;margin-top:12px;color:#78716c;font-size:12px;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <div class="icon">${ok ? "✅" : outcome === "canceled" ? "↩️" : outcome === "pending" ? "⏳" : "❌"}</div>
  <h1>${title}</h1>
  <p>${detail}</p>
  <a class="btn" href="${esc(target)}">بازگشت به روتینو</a>
  ${native ? `<a class="alt" href="${esc(webUrl)}">باز نشد؟ نسخه وب را باز کن</a>` : ""}
</div>
<script>
  // Give the user a beat to read the outcome, then return to the app.
  setTimeout(function () { window.location.href = ${JSON.stringify(target)}; }, ${ok ? 1600 : 4000});
</script>
</body>
</html>`;
  return reply.type("text/html; charset=utf-8").send(html);
}
