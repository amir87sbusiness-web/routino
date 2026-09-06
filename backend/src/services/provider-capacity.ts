import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { providerCapacityLeases } from "../db/schema.js";
import type { Database } from "../db/client.js";

export interface ProviderLease {
  leaseId: string;
}

/**
 * Claims one short-lived provider permit. A transaction-scoped advisory lock
 * serialises only callers for the same provider kind; expired crash permits are
 * reclaimed before capacity is counted.
 */
export async function acquireProviderLease(
  db: Database,
  kind: string,
  maxConcurrent: number,
  now: Date,
  ttlMs: number,
): Promise<ProviderLease | null> {
  const leaseId = randomUUID();
  return db.transaction(async (tx) => {
    // The kind is not user input, but remains a bound parameter. Drizzle's
    // query builder has no advisory-lock primitive.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"provider-capacity:" + kind}))`);
    await tx
      .delete(providerCapacityLeases)
      .where(and(eq(providerCapacityLeases.kind, kind), lt(providerCapacityLeases.expiresAt, now)));

    const live = await tx
      .select({ leaseId: providerCapacityLeases.leaseId })
      .from(providerCapacityLeases)
      .where(eq(providerCapacityLeases.kind, kind))
      .limit(maxConcurrent);
    if (live.length >= maxConcurrent) return null;

    await tx.insert(providerCapacityLeases).values({
      kind,
      leaseId,
      expiresAt: new Date(now.getTime() + ttlMs),
      createdAt: now,
    });
    return { leaseId };
  });
}

export async function releaseProviderLease(
  db: Database,
  kind: string,
  leaseId: string,
): Promise<void> {
  try {
    await db
      .delete(providerCapacityLeases)
      .where(
        and(eq(providerCapacityLeases.kind, kind), eq(providerCapacityLeases.leaseId, leaseId)),
      );
  } catch (err) {
    // Provider work has already finished at this point. Expiry reclaims the
    // anonymous lease, so cleanup failure must not turn a delivered SMS or an
    // issued payment authority into a client-visible failure and duplicate retry.
    console.error("provider lease cleanup failed; expiry will reclaim it", { kind, err });
  }
}
