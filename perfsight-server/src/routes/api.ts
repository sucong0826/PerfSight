import { Router } from "express";
import { prisma } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export const apiRouter = Router();

// ====================
// Dataset Types (matching client's ReportDatasetV1)
// ====================
interface MetricPoint {
  timestamp: string;
  pid: number;
  cpu_usage?: number;
  cpu_os_usage?: number;
  cpu_chrome_usage?: number;
  memory_rss?: number;
  memory_footprint?: number;
  memory_private?: number;
  gpu_usage?: number;
  js_heap_size?: number;
  custom_metrics?: Record<string, number>;
}

interface BatchMetric {
  timestamp: string;
  metrics: Record<string, MetricPoint>;
}

interface AnalysisSummary {
  avg_cpu?: number;
  max_cpu?: number;
  p95_cpu?: number;
  avg_mem_mb?: number;
  max_mem_mb?: number;
  p95_mem_mb?: number;
  [key: string]: any;
}

interface Analysis {
  score?: number;
  summary?: AnalysisSummary;
  insights?: string[];
  [key: string]: any;
}

interface ReportMeta {
  test_context?: {
    scenario_name?: string;
    build_id?: string;
    tags?: string[];
    notes?: string;
  };
  collection?: {
    mode?: string;
    metric_standard?: string;
    interval_ms?: number;
    duration_seconds?: number;
    stop_after_seconds?: number;
    started_at?: string;
    folder_path?: string;
  };
  env?: {
    os?: string;
    arch?: string;
    device_name?: string;
    cpu_brand?: string;
    total_mem_gb?: number;
    browser_channel?: string;
    browser_version?: string;
    extension_version?: string;
    app_version?: string;
  };
  process_snapshot?: Array<{
    pid: number;
    name?: string;
    title?: string;
    alias?: string;
    proc_type?: string;
  }>;
  [key: string]: any;
}

interface ReportDetail {
  id: number;
  created_at: string;
  title: string;
  metrics: BatchMetric[];
  analysis?: Analysis;
  meta?: ReportMeta;
}

interface ReportDatasetV1 {
  schema_version: number;
  exported_at: string;
  report: ReportDetail;
}

// ====================
// Helper Functions
// ====================
function extractRelease(meta?: ReportMeta): string | null {
  const tags = meta?.test_context?.tags || [];
  for (const tag of tags) {
    if (typeof tag === "string" && tag.startsWith("release:")) {
      return tag.slice(8);
    }
  }
  return null;
}

function extractPlatform(meta?: ReportMeta): string | null {
  const os = meta?.env?.os?.toLowerCase() || "";
  if (os.includes("mac") || os.includes("darwin")) return "macos";
  if (os.includes("win")) return "windows";
  if (os.includes("linux")) return "linux";
  if (os.includes("chromeos")) return "chromeos";
  if (os.includes("android")) return "android";
  if (os.includes("ios")) return "ios";
  return os || null;
}

function computeStats(metrics: BatchMetric[]): {
  avgCpu: number | null;
  avgMemMb: number | null;
  p95Cpu: number | null;
  p95MemMb: number | null;
} {
  const cpuValues: number[] = [];
  const memValues: number[] = [];

  for (const batch of metrics) {
    for (const pidStr of Object.keys(batch.metrics || {})) {
      const p = batch.metrics[pidStr];
      const cpu =
        p?.cpu_chrome_usage ?? p?.cpu_os_usage ?? p?.cpu_usage;
      const mem =
        p?.memory_private ?? p?.memory_footprint ?? p?.memory_rss;
      if (typeof cpu === "number" && Number.isFinite(cpu)) cpuValues.push(cpu);
      if (typeof mem === "number" && Number.isFinite(mem)) memValues.push(mem);
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
  const percentile = (arr: number[], p: number) => {
    if (!arr.length) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
    return sorted[idx];
  };

  return {
    avgCpu: avg(cpuValues),
    avgMemMb: memValues.length ? (avg(memValues)! / (1024 * 1024)) : null,
    p95Cpu: percentile(cpuValues, 0.95),
    p95MemMb: memValues.length ? (percentile(memValues, 0.95)! / (1024 * 1024)) : null,
  };
}

// ====================
// API Endpoints
// ====================

/**
 * POST /api/v1/datasets
 * Upload a dataset (ReportDatasetV1 JSON)
 */
apiRouter.post("/datasets", async (req, res) => {
  try {
    const dataset = req.body as ReportDatasetV1;

    // Validate
    if (!dataset || dataset.schema_version !== 1) {
      return res.status(400).json({ error: "Invalid dataset: schema_version must be 1" });
    }
    if (!dataset.report) {
      return res.status(400).json({ error: "Invalid dataset: missing report" });
    }

    const report = dataset.report;
    const meta = report.meta;

    // Check for duplicate import (same original ID + same reportDate)
    const existingRun = await prisma.run.findFirst({
      where: {
        originalId: report.id,
        reportDate: new Date(report.created_at),
      },
    });

    if (existingRun) {
      return res.status(409).json({
        error: "Duplicate dataset",
        message: `This report has already been imported (existing ID: ${existingRun.id})`,
        existingRunId: existingRun.id,
      });
    }

    // Extract indexed fields
    const release = extractRelease(meta);
    const scenario = meta?.test_context?.scenario_name || null;
    const buildId = meta?.test_context?.build_id || null;
    const platform = extractPlatform(meta);
    const browser = meta?.env?.browser_channel || null;
    const mode = meta?.collection?.mode || null;
    const tags = JSON.stringify(meta?.test_context?.tags || []);
    const durationSeconds = meta?.collection?.duration_seconds || null;

    // Compute stats
    const stats = computeStats(report.metrics || []);

    // Store
    const run = await prisma.run.create({
      data: {
        originalId: report.id,
        title: report.title || `Report ${report.id}`,
        reportDate: new Date(report.created_at),
        release,
        scenario,
        buildId,
        platform,
        browser,
        mode,
        tags,
        durationSeconds,
        datasetJson: JSON.stringify(dataset),
        avgCpu: stats.avgCpu,
        avgMemMb: stats.avgMemMb,
        p95Cpu: stats.p95Cpu,
        p95MemMb: stats.p95MemMb,
      },
    });

    console.log(`✅ Uploaded run: ${run.id} (${run.title})`);

    res.status(201).json({
      success: true,
      run: {
        id: run.id,
        title: run.title,
        createdAt: run.createdAt,
      },
    });
  } catch (err) {
    console.error("Upload failed:", err);
    res.status(500).json({ error: "Upload failed", details: String(err) });
  }
});

/**
 * GET /api/v1/runs
 * List runs with optional filters
 */
apiRouter.get("/runs", async (req, res) => {
  try {
    const {
      release,
      scenario,
      buildId,
      platform,
      tags,
      limit = "50",
      offset = "0",
    } = req.query;

    const where: any = {};
    if (release) where.release = String(release);
    if (scenario) where.scenario = { contains: String(scenario) };
    if (buildId) where.buildId = { contains: String(buildId) };
    if (platform) where.platform = String(platform);
    if (tags) where.tags = { contains: String(tags) };

    const runs = await prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(Number(limit), 200),
      skip: Number(offset),
      select: {
        id: true,
        createdAt: true,
        title: true,
        reportDate: true,
        release: true,
        scenario: true,
        buildId: true,
        platform: true,
        browser: true,
        mode: true,
        tags: true,
        durationSeconds: true,
        avgCpu: true,
        avgMemMb: true,
        p95Cpu: true,
        p95MemMb: true,
        // Don't include full datasetJson in list
      },
    });

    const total = await prisma.run.count({ where });

    res.json({
      runs: runs.map((r) => ({
        ...r,
        tags: JSON.parse(r.tags || "[]"),
      })),
      total,
      limit: Number(limit),
      offset: Number(offset),
    });
  } catch (err) {
    console.error("List runs failed:", err);
    res.status(500).json({ error: "List runs failed", details: String(err) });
  }
});

/**
 * GET /api/v1/runs/:id
 * Get run detail (includes full dataset)
 */
apiRouter.get("/runs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const run = await prisma.run.findUnique({
      where: { id },
    });

    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }

    // Parse the stored dataset
    const dataset = JSON.parse(run.datasetJson) as ReportDatasetV1;

    res.json({
      id: run.id,
      createdAt: run.createdAt,
      title: run.title,
      reportDate: run.reportDate,
      release: run.release,
      scenario: run.scenario,
      buildId: run.buildId,
      platform: run.platform,
      browser: run.browser,
      mode: run.mode,
      tags: JSON.parse(run.tags || "[]"),
      durationSeconds: run.durationSeconds,
      avgCpu: run.avgCpu,
      avgMemMb: run.avgMemMb,
      p95Cpu: run.p95Cpu,
      p95MemMb: run.p95MemMb,
      // Full report data from dataset
      report: dataset.report,
    });
  } catch (err) {
    console.error("Get run failed:", err);
    res.status(500).json({ error: "Get run failed", details: String(err) });
  }
});

/**
 * DELETE /api/v1/runs/:id
 * Delete a run
 */
apiRouter.delete("/runs/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.run.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch (err) {
    console.error("Delete run failed:", err);
    res.status(500).json({ error: "Delete run failed", details: String(err) });
  }
});

/**
 * GET /api/v1/tags
 * Get tag statistics
 */
apiRouter.get("/tags", async (req, res) => {
  try {
    const runs = await prisma.run.findMany({
      select: { tags: true },
    });

    const tagCounts: Record<string, number> = {};
    for (const run of runs) {
      const tags = JSON.parse(run.tags || "[]") as string[];
      for (const tag of tags) {
        tagCounts[tag] = (tagCounts[tag] || 0) + 1;
      }
    }

    const result = Object.entries(tagCounts)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    res.json({ tags: result });
  } catch (err) {
    console.error("Get tags failed:", err);
    res.status(500).json({ error: "Get tags failed", details: String(err) });
  }
});

/**
 * GET /api/v1/filters
 * Get available filter options (releases, scenarios, platforms, etc.)
 */
apiRouter.get("/filters", async (req, res) => {
  try {
    const [releases, scenarios, platforms, browsers, modes] = await Promise.all([
      prisma.run.findMany({ distinct: ["release"], where: { release: { not: null } }, select: { release: true } }),
      prisma.run.findMany({ distinct: ["scenario"], where: { scenario: { not: null } }, select: { scenario: true } }),
      prisma.run.findMany({ distinct: ["platform"], where: { platform: { not: null } }, select: { platform: true } }),
      prisma.run.findMany({ distinct: ["browser"], where: { browser: { not: null } }, select: { browser: true } }),
      prisma.run.findMany({ distinct: ["mode"], where: { mode: { not: null } }, select: { mode: true } }),
    ]);

    res.json({
      releases: releases.map((r) => r.release).filter(Boolean),
      scenarios: scenarios.map((r) => r.scenario).filter(Boolean),
      platforms: platforms.map((r) => r.platform).filter(Boolean),
      browsers: browsers.map((r) => r.browser).filter(Boolean),
      modes: modes.map((r) => r.mode).filter(Boolean),
    });
  } catch (err) {
    console.error("Get filters failed:", err);
    res.status(500).json({ error: "Get filters failed", details: String(err) });
  }
});

/**
 * POST /api/v1/bundles
 * Import a comparison bundle (multiple reports + comparison context)
 */
apiRouter.post("/bundles", async (req, res) => {
  try {
    const bundle = req.body;

    // Validate bundle format
    if (!bundle || bundle.schema_version !== 1) {
      return res.status(400).json({ error: "Invalid bundle: schema_version must be 1" });
    }
    if (bundle.bundle_type !== "comparison") {
      return res.status(400).json({ error: "Invalid bundle: bundle_type must be 'comparison'" });
    }
    if (!Array.isArray(bundle.reports) || bundle.reports.length < 2) {
      return res.status(400).json({ error: "Invalid bundle: at least 2 reports required" });
    }

    const importedRuns: Array<{ id: string; originalId: number; title: string }> = [];
    const idMapping: Record<number, string> = {}; // originalId -> new server ID

    // Import each report
    for (const report of bundle.reports) {
      const meta = report.meta;

      // Check for existing import
      const existingRun = await prisma.run.findFirst({
        where: {
          originalId: report.id,
          reportDate: new Date(report.created_at),
        },
      });

      if (existingRun) {
        // Already exists, use existing ID
        idMapping[report.id] = existingRun.id;
        importedRuns.push({
          id: existingRun.id,
          originalId: report.id,
          title: existingRun.title,
        });
        continue;
      }

      // Extract indexed fields
      const release = extractRelease(meta);
      const scenario = meta?.test_context?.scenario_name || null;
      const buildId = meta?.test_context?.build_id || null;
      const platform = extractPlatform(meta);
      const browser = meta?.env?.browser_channel || null;
      const mode = meta?.collection?.mode || null;
      const tags = JSON.stringify(meta?.test_context?.tags || []);
      const durationSeconds = meta?.collection?.duration_seconds || null;

      // Compute stats
      const stats = computeStats(report.metrics || []);

      // Create a single-report dataset for storage
      const singleDataset: ReportDatasetV1 = {
        schema_version: 1,
        exported_at: bundle.exported_at,
        report: report,
      };

      // Store
      const run = await prisma.run.create({
        data: {
          originalId: report.id,
          title: report.title || `Report ${report.id}`,
          reportDate: new Date(report.created_at),
          release,
          scenario,
          buildId,
          platform,
          browser,
          mode,
          tags,
          durationSeconds,
          datasetJson: JSON.stringify(singleDataset),
          avgCpu: stats.avgCpu,
          avgMemMb: stats.avgMemMb,
          p95Cpu: stats.p95Cpu,
          p95MemMb: stats.p95MemMb,
        },
      });

      idMapping[report.id] = run.id;
      importedRuns.push({
        id: run.id,
        originalId: report.id,
        title: run.title,
      });
    }

    // Map comparison context to new IDs
    const comparisonContext = bundle.comparison_context || {};
    const baselineOriginalId = comparisonContext.baseline_original_id;
    const newBaselineId = baselineOriginalId != null ? idMapping[baselineOriginalId] : null;

    // Map process selections to new IDs
    const mapSelections = (selections: Record<string, number[]> | undefined) => {
      if (!selections) return {};
      const result: Record<string, number[]> = {};
      for (const [origId, pids] of Object.entries(selections)) {
        const newId = idMapping[Number(origId)];
        if (newId && Array.isArray(pids)) {
          result[newId] = pids;
        }
      }
      return result;
    };

    console.log(`✅ Imported bundle with ${importedRuns.length} reports`);

    res.status(201).json({
      success: true,
      imported: importedRuns,
      comparison: {
        runIds: importedRuns.map((r) => r.id),
        baselineId: newBaselineId,
        cpuSelections: mapSelections(comparisonContext.cpu_selections_by_id),
        memSelections: mapSelections(comparisonContext.mem_selections_by_id),
      },
    });
  } catch (err) {
    console.error("Bundle import failed:", err);
    res.status(500).json({ error: "Bundle import failed", details: String(err) });
  }
});

/**
 * POST /api/v1/compare
 * Compare multiple runs
 */
apiRouter.post("/compare", async (req, res) => {
  try {
    const { ids } = req.body as { ids: string[] };

    if (!ids || !Array.isArray(ids) || ids.length < 2) {
      return res.status(400).json({ error: "At least 2 run IDs required" });
    }

    const runs = await prisma.run.findMany({
      where: { id: { in: ids } },
    });

    if (runs.length !== ids.length) {
      return res.status(404).json({ error: "Some runs not found" });
    }

    const result = runs.map((run) => {
      const dataset = JSON.parse(run.datasetJson) as ReportDatasetV1;
      return {
        id: run.id,
        title: run.title,
        reportDate: run.reportDate,
        release: run.release,
        scenario: run.scenario,
        avgCpu: run.avgCpu,
        avgMemMb: run.avgMemMb,
        p95Cpu: run.p95Cpu,
        p95MemMb: run.p95MemMb,
        report: dataset.report,
      };
    });

    res.json({ runs: result });
  } catch (err) {
    console.error("Compare runs failed:", err);
    res.status(500).json({ error: "Compare runs failed", details: String(err) });
  }
});

