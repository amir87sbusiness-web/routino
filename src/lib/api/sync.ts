/** Delta sync transport. The protocol is described in `backend/src/services/sync.ts`. */
import { authedRequest, type ServerEntitlement } from "./auth";

export interface SyncRecord {
  kind: string;
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
}

export type SyncRejectionCode =
  | "bad_kind"
  | "bad_id"
  | "bad_updated_at"
  | "invalid_record"
  | "record_too_large"
  | "account_quota_exceeded";

export interface RejectedSyncRecord {
  kind: string;
  id: string;
  updatedAt: number;
  code: SyncRejectionCode;
  retryAt?: number;
}

export interface RemoteRecord extends SyncRecord {
  seq: number;
}

export interface PushResponse {
  cursor: number;
  applied: number;
  skipped: number;
  rejectedRecords: RejectedSyncRecord[];
}

export interface PullResponse {
  records: RemoteRecord[];
  cursor: number;
  hasMore: boolean;
  /** The device fell behind the tombstone purge; wipe and pull from zero. */
  reset: boolean;
  /** Tombstone purge watermark used to bind a stateless full-resync continuation. */
  gcSeq?: number;
  /** Present on the LAST page only. The app reads its paywall from this instead
   * of spending a second invocation on GET /subscriptions/me every boot. */
  entitlement?: ServerEntitlement;
}

export interface ExchangeRequest {
  protocolVersion: 2;
  cursor: number;
  records: SyncRecord[];
  includeAccountState?: boolean;
  limit?: number;
  /** Read-only continuation after cursor-zero/reset pagination. */
  fullResyncGcSeq?: number;
}

export interface ExchangeResponse extends PullResponse {
  applied: number;
  skipped: number;
  rejectedRecords: RejectedSyncRecord[];
  /** False means the cursor gate rejected every uploaded row before writing;
   * retain their local dirty flags, wipe synced copies, and pull from zero. */
  batchAccepted: boolean;
}

export function exchangeRecords(
  request: ExchangeRequest,
  expectedUserId?: string,
  keepalive = false,
): Promise<ExchangeResponse> {
  return authedRequest("/sync/exchange", {
    method: "POST",
    body: request,
    expectedUserId,
    keepalive,
  });
}

export function pushRecords(records: SyncRecord[], expectedUserId?: string): Promise<PushResponse> {
  return authedRequest("/sync/push", { method: "POST", body: { records }, expectedUserId });
}

export function pullRecords(
  cursor: number,
  limit?: number,
  expectedUserId?: string,
): Promise<PullResponse> {
  const q = limit ? `?cursor=${cursor}&limit=${limit}` : `?cursor=${cursor}`;
  return authedRequest(`/sync/pull${q}`, { expectedUserId });
}
