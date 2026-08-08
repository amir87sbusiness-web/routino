/** Delta sync transport. The protocol is described in `backend/src/services/sync.ts`. */
import { authedRequest, type ServerEntitlement } from "./auth";

export interface SyncRecord {
  kind: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

export interface RemoteRecord extends SyncRecord {
  seq: number;
}

export interface PushResponse {
  cursor: number;
  applied: number;
  skipped: number;
}

export interface PullResponse {
  records: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
  /** The device fell behind the tombstone purge; wipe and pull from zero. */
  reset: boolean;
  /** Present on the LAST page only. The app reads its paywall from this instead
   * of spending a second invocation on GET /subscriptions/me every boot. */
  entitlement?: ServerEntitlement;
}

export function pushRecords(records: SyncRecord[]): Promise<PushResponse> {
  return authedRequest("/sync/push", { method: "POST", body: { records } });
}

export function pullRecords(cursor: number, limit?: number): Promise<PullResponse> {
  const q = limit ? `?cursor=${cursor}&limit=${limit}` : `?cursor=${cursor}`;
  return authedRequest(`/sync/pull${q}`);
}
