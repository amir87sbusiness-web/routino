import type { PspCheckout, PspName, PspProvider, PspRequestInput, PspRouter, PspVerifyResult } from "./index.js";

/**
 * Multi-gateway router.
 *
 * Goal (from the product owner): "if only one gateway is configured that is
 * enough, and the server always picks the fastest gateway for the user."
 *
 * How "fastest" is measured: the real round-trip time of each provider's
 * `request()` call, kept as an exponential moving average (EMA). No synthetic
 * pinging — the signal is the actual checkout latency users feel. A provider
 * that throws or hard-rejects is parked as unhealthy for a short window so the
 * next checkout prefers the other one; if it is the only provider, it is still
 * used (there is nothing to fail over to).
 *
 * Ordering per checkout: healthy providers first, then ascending EMA latency,
 * config order as the tiebreak (and the cold-start order, before any latency is
 * known). We then try them in that order and return the first success —
 * automatic failover. verify()/startUrl() do NOT route by health: they take the
 * provider recorded on the payment, so a transaction is always finished on the
 * gateway that started it.
 *
 * State is in-process and best-effort. Render runs a single instance, so this is
 * adequate; a multi-instance deploy would simply rebuild the EMA per instance,
 * which is harmless.
 */

/** How long a provider that just failed is de-prioritised. */
const UNHEALTHY_MS = 60_000;
/** EMA weight on the newest sample. Higher = more reactive, less smooth. */
const EMA_ALPHA = 0.3;

interface Health {
  /** EMA of request() latency in ms; undefined until the first sample. */
  ema?: number;
  /** Epoch ms until which this provider is treated as unhealthy. */
  downUntil: number;
}

export function createRouter(list: PspProvider[], nowFn: () => number = Date.now): PspRouter {
  if (list.length === 0) throw new Error("createRouter: at least one provider is required");

  const providers = list.map((p) => p.name);
  const byName = new Map<PspName, PspProvider>(list.map((p) => [p.name, p]));
  // Config order, used as a stable tiebreak so the first-listed gateway wins ties.
  const rank = new Map<PspName, number>(list.map((p, i) => [p.name, i]));
  const health = new Map<PspName, Health>(list.map((p) => [p.name, { downUntil: 0 }]));

  function record(name: PspName, latencyMs: number): void {
    const h = health.get(name)!;
    h.ema = h.ema === undefined ? latencyMs : h.ema * (1 - EMA_ALPHA) + latencyMs * EMA_ALPHA;
  }

  /** Providers ordered best-first for a fresh checkout. */
  function ordered(now: number): PspProvider[] {
    return [...list].sort((a, b) => {
      const ha = health.get(a.name)!;
      const hb = health.get(b.name)!;
      const downA = ha.downUntil > now ? 1 : 0;
      const downB = hb.downUntil > now ? 1 : 0;
      if (downA !== downB) return downA - downB; // healthy first
      const ea = ha.ema ?? 0; // untried sorts as fastest, so it gets sampled
      const eb = hb.ema ?? 0;
      if (ea !== eb) return ea - eb;
      return rank.get(a.name)! - rank.get(b.name)!; // config order
    });
  }

  return {
    providers,
    get: (name) => byName.get(name),

    async request(input: PspRequestInput): Promise<PspCheckout> {
      const now = nowFn();
      let last: PspCheckout | undefined;
      for (const p of ordered(now)) {
        const t0 = nowFn();
        try {
          const res = await p.request(input);
          record(p.name, nowFn() - t0);
          if (res.ok) return { ...res, provider: p.name };
          // Hard rejection (bad merchant, amount, etc.): park briefly and try the
          // next gateway — with multiple gateways a transient reject on one must
          // not fail the whole checkout.
          health.get(p.name)!.downUntil = nowFn() + UNHEALTHY_MS;
          last = { ...res, provider: p.name };
        } catch (err) {
          // Network/timeout/HTTP error: definitely unhealthy.
          health.get(p.name)!.downUntil = nowFn() + UNHEALTHY_MS;
          last = {
            ok: false,
            provider: p.name,
            result: 0,
            message: err instanceof Error ? err.message : "psp request threw",
          };
        }
      }
      return last ?? { ok: false, provider: providers[0]!, result: 0, message: "no psp provider" };
    },

    verify(provider: PspName, ref: string, amountRial: number): Promise<PspVerifyResult> {
      const p = byName.get(provider);
      if (!p) throw new Error(`psp verify: unknown provider ${provider}`);
      return p.verify(ref, amountRial);
    },

    startUrl(provider: PspName, ref: string): string {
      const p = byName.get(provider);
      if (!p) throw new Error(`psp startUrl: unknown provider ${provider}`);
      return p.startUrl(ref);
    },
  };
}
