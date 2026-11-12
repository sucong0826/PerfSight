import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import type { ErrorRequestHandler } from "express";
import { apiRouter } from "./routes/api.js";
import { initDatabase } from "./db.js";
import { apiRateLimit } from "./rateLimit.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST?.trim() || "0.0.0.0";
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}
const allowedOrigins = new Set(
  (process.env.PERFSIGHT_CORS_ORIGINS || "tauri://localhost,http://tauri.localhost,https://tauri.localhost,http://localhost:1420,http://127.0.0.1:1420")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.disable("x-powered-by");
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Strict-Transport-Security", "max-age=15552000");
  res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  next();
});

// Middleware
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
  maxAge: 600,
}));
app.use("/api/v1", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

// Initialize database and start server
async function main() {
  const staticDir = path.join(__dirname, "..", "public");

  app.use("/api/v1", apiRateLimit);
  app.use(express.json({ limit: "100mb", inflate: false })); // Bounded, uncompressed datasets
  app.use("/api/v1", apiRouter);
  app.use(express.static(staticDir));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) {
      return res.status(404).json({ error: "Not found" });
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });

  const safeErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }
    const candidate = typeof error === "object" && error !== null && "status" in error
      ? Number((error as { status?: unknown }).status)
      : 500;
    const status = Number.isInteger(candidate) && candidate >= 400 && candidate < 500 ? candidate : 500;
    console.error(status < 500 ? "Request rejected." : "Request processing failed.");
    res.status(status).json({
      error: status === 413 ? "Request body too large." : status < 500 ? "Invalid request." : "Request failed.",
    });
  };
  app.use(safeErrorHandler);

  await initDatabase();
  
  app.listen(PORT, HOST, () => {
    console.log(`PerfSight Server listening on ${HOST}:${PORT}`);
    console.log(`API: /api/v1 (open access)`);
  });
}

main().catch((error: unknown) => {
  console.error("PerfSight Server failed to start:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});

