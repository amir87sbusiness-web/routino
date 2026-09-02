import { validateTaskPayload } from "./sync-record-validation.js";

export const TASK_MONTH_ARCHIVE_KIND = "taskMonths" as const;
export const TASK_MONTH_ARCHIVE_VERSION = 1 as const;

export interface TaskMonthArchiveV1 {
  v: 1;
  monthKey: string;
  count: number;
  checksum: string;
  items: [id: string, updatedAt: number, data: unknown][];
}

export interface StoredTaskMonthRecord {
  kind: "taskMonths";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: boolean;
  seq: number;
}

export interface ArchivedTaskPullRecord {
  kind: "tasks";
  id: string;
  data: unknown;
  updatedAt: number;
  deleted: false;
  seq: number;
}

export function isTaskMonthArchiveKind(kind: string): kind is "taskMonths" {
  return kind === TASK_MONTH_ARCHIVE_KIND;
}

const MONTH_KEY_RE = /^\d{4}-\d{2}$/;
const CHECKSUM_RE = /^[a-f0-9]{32}$/;
const ARCHIVE_KEYS = ["v", "monthKey", "count", "checksum", "items"] as const;

function isMonthKey(value: string): boolean {
  if (!MONTH_KEY_RE.test(value)) return false;
  const parsed = new Date(`${value}-01T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 7) === value;
}

function isArchiveData(value: unknown): value is TaskMonthArchiveV1 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    data.v === TASK_MONTH_ARCHIVE_VERSION &&
    typeof data.monthKey === "string" &&
    typeof data.count === "number" &&
    typeof data.checksum === "string" &&
    Array.isArray(data.items) &&
    Object.keys(data).length === ARCHIVE_KEYS.length &&
    Object.keys(data).every((key) => (ARCHIVE_KEYS as readonly string[]).includes(key))
  );
}

function invalidArchive(): never {
  throw new Error("invalid_task_month_archive");
}

const rotateLeft = (value: number, bits: number) => (value << bits) | (value >>> (32 - bits));

/** Small portable MD5 implementation for the permanent v1 PostgreSQL archive
 * convention. It uses Web-standard TextEncoder only: Edge/Deno and Node agree,
 * while Node's crypto module is intentionally not required at runtime. */
function md5Hex(value: string): string {
  const source = new TextEncoder().encode(value);
  const padded = new Uint8Array((source.length + 9 + 63) & ~63);
  padded.set(source);
  padded[source.length] = 0x80;
  const bitLength = source.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, bitLength >>> 0, true);
  view.setUint32(padded.length - 4, Math.floor(bitLength / 0x1_0000_0000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, index) =>
      view.getUint32(offset + index * 4, true),
    );
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;
    for (let i = 0; i < 64; i += 1) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const next = d;
      d = c;
      c = b;
      const constant = Math.floor(Math.abs(Math.sin(i + 1)) * 0x1_0000_0000);
      b = (b + rotateLeft((a + f + constant + words[g]!) >>> 0, shifts[i]!)) >>> 0;
      a = next;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }

  return [a0, b0, c0, d0]
    .flatMap((word) => [word & 0xff, (word >>> 8) & 0xff, (word >>> 16) & 0xff, word >>> 24])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** PostgreSQL jsonb's stable text representation: keys are stored by byte
 * length then byte order, and its output uses comma/colon spaces. Task payload
 * keys are ASCII by validation, so byte and code-point ordering are identical. */
function postgresJsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(postgresJsonbText).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}: ${postgresJsonbText(item)}`).join(", ")}}`;
  }
  return JSON.stringify(value);
}

export function expandTaskMonthArchive(record: StoredTaskMonthRecord): ArchivedTaskPullRecord[] {
  if (record.deleted) return invalidArchive();
  if (!isArchiveData(record.data)) {
    const data = record.data as { v?: unknown } | null;
    if (data?.v !== TASK_MONTH_ARCHIVE_VERSION) {
      throw new Error("unsupported_task_archive_version");
    }
    return invalidArchive();
  }

  const archive = record.data;
  if (
    !isMonthKey(archive.monthKey) ||
    !Number.isSafeInteger(record.updatedAt) ||
    record.updatedAt < 0 ||
    !Number.isSafeInteger(archive.count) ||
    archive.count < 1 ||
    archive.count > 32 ||
    archive.count !== archive.items.length ||
    !CHECKSUM_RE.test(archive.checksum)
  ) {
    return invalidArchive();
  }

  const ids = new Set<string>();
  const expanded: ArchivedTaskPullRecord[] = [];
  let previousId = "";
  let maxUpdatedAt = -1;
  const checksumParts: string[] = [];
  for (const item of archive.items) {
    if (!Array.isArray(item) || item.length !== 3) return invalidArchive();
    const [id, updatedAt, data] = item;
    if (
      typeof id !== "string" ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < 0 ||
      ids.has(id) ||
      !validateTaskPayload(id, data) ||
      (data as { dateKey: string }).dateKey.slice(0, 7) !== archive.monthKey ||
      (previousId !== "" && id <= previousId)
    ) {
      return invalidArchive();
    }
    ids.add(id);
    previousId = id;
    maxUpdatedAt = Math.max(maxUpdatedAt, updatedAt);
    checksumParts.push(`${id}\n${updatedAt}\n${postgresJsonbText(data)}`);
    expanded.push({ kind: "tasks", id, data, updatedAt, deleted: false, seq: record.seq });
  }

  if (
    record.updatedAt !== maxUpdatedAt ||
    record.id !== `${archive.monthKey}|${md5Hex([...ids].join("\n"))}` ||
    archive.checksum !== md5Hex(checksumParts.join("\n"))
  ) {
    return invalidArchive();
  }

  return expanded;
}
