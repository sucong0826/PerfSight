import type { RequestHandler } from "express";

const RATE_WINDOW_MS = 60_000;
const MAX_RATE_BUCKETS = 10_000;
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function allowRequest(key: string, limit: number, now = Date.now()): { allowed: boolean; retrySeconds: number } {
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    if (!bucket && rateBuckets.size >= MAX_RATE_BUCKETS) {
      const oldestKey = rateBuckets.keys().next().value;
      if (oldestKey) rateBuckets.delete(oldestKey);
    }
    bucket = { windowStart: now, count: 0 };
    rateBuckets.set(key, bucket);
  }

  bucket.count += 1;
  return {
    allowed: bucket.count <= limit,
    retrySeconds: Math.max(1, Math.ceil((bucket.windowStart + RATE_WINDOW_MS - now) / 1000)),
  };
}

export const apiRateLimit: RequestHandler = (req, res, next) => {
  if (req.method === "OPTIONS") {
    next();
    return;
  }

  const isIngest = req.method === "POST" && req.path === "/datasets";
  const group = isIngest ? "ingest" : "read-write";
  const rate = allowRequest(`${group}:${req.ip || req.socket.remoteAddress || "unknown"}`, isIngest ? 60 : 300);
  if (!rate.allowed) {
    res.setHeader("Retry-After", String(rate.retrySeconds));
    res.status(429).json({ error: "Too many requests. Try again shortly." });
    return;
  }

  next();
};
