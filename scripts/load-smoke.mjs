import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

export function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export async function runLoadSmoke({
  baseUrl,
  requests = 200,
  concurrency = 20,
  fetchImpl = fetch,
}) {
  const base = new URL(baseUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(base.hostname);
  if (!local && process.env.ALLOW_REMOTE_LOAD !== "true") {
    throw new Error("Remote load is disabled. This smoke test is intended for a local API.");
  }

  const paths = ["/health", "/v1/plans", "/v1/devices/ping"];
  const results = [];
  let next = 0;
  const worker = async () => {
    while (next < requests) {
      const index = next++;
      const path = paths[index % paths.length];
      const startedAt = performance.now();
      try {
        const response = await fetchImpl(new URL(path, base), {
          headers: path.includes("devices") ? { authorization: "Bearer invalid" } : undefined,
        });
        await response.arrayBuffer();
        results.push({ status: response.status, durationMs: performance.now() - startedAt });
      } catch {
        results.push({ status: 0, durationMs: performance.now() - startedAt });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, worker));

  const durations = results.map((result) => result.durationMs);
  const statuses = Object.fromEntries(
    [...new Set(results.map((result) => result.status))]
      .sort((a, b) => a - b)
      .map((status) => [status, results.filter((result) => result.status === status).length]),
  );
  return {
    target: base.origin,
    requests: results.length,
    concurrency,
    errors: results.filter((result) => result.status === 0 || result.status >= 500).length,
    statuses,
    latencyMs: {
      p50: Math.round(percentile(durations, 0.5)),
      p95: Math.round(percentile(durations, 0.95)),
      max: Math.round(Math.max(...durations)),
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) ===
    fileURLToPath(new URL(`file:///${process.argv[1].replace(/\\/g, "/")}`))
) {
  const report = await runLoadSmoke({
    baseUrl: option("--url", "http://127.0.0.1:3000"),
    requests: Number(option("--requests", "200")),
    concurrency: Number(option("--concurrency", "20")),
  });
  console.log(JSON.stringify(report, null, 2));
  if (report.errors) process.exitCode = 1;
}
