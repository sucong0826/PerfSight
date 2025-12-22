import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { apiRouter } from "./routes/api.js";
import { initDatabase } from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "100mb" })); // Large datasets

// API routes
app.use("/api/v1", apiRouter);

// Serve static frontend (Web UI)
const staticDir = path.join(__dirname, "..", "public");
app.use(express.static(staticDir));

// SPA fallback for frontend routes
app.get("*", (req, res) => {
  // Don't serve index.html for API routes
  if (req.path.startsWith("/api")) {
    return res.status(404).json({ error: "Not found" });
  }
  res.sendFile(path.join(staticDir, "index.html"));
});

// Initialize database and start server
async function main() {
  await initDatabase();
  
  app.listen(PORT, () => {
    console.log(`🚀 PerfSight Server running at http://localhost:${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api/v1`);
    console.log(`   Web: http://localhost:${PORT}`);
  });
}

main().catch(console.error);

