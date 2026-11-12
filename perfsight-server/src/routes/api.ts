import { Router } from "express";
import { prisma } from "../db.js";
import { createHash } from "node:crypto";
import { z } from "zod";

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
  source?: {
    client_id?: string;
    client_type?: string;
  };
  [key: string]: any;
}

interface ReportDetail {
  id: number;
  created_at: string;
  title: string;
  metrics: BatchMetric[];
  analysis?: Analysis;
  meta?: ReportMeta | null;
}

interface ReportDatasetV1 {
  schema_version: number;
  exported_at: string;
  report: ReportDetail;
}

const dateTimeSchema = z.string().max(64).refine((value) => Number.isFinite(Date.parse(value)));
const nonNegativeInteger = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cpuMetric = z.number().finite().min(0).max(100_000);
const metricPointSchema = z.object({
  timestamp: dateTimeSchema,
  pid: z.number().int().nonnegative().max(4_294_967_295),
  cpu_usage: cpuMetric.optional(),
  cpu_os_usage: cpuMetric.optional(),
  cpu_chrome_usage: cpuMetric.nullable().optional(),
  memory_rss: nonNegativeInteger.optional(),
  memory_footprint: nonNegativeInteger.nullable().optional(),
  memory_private: nonNegativeInteger.nullable().optional(),
  gpu_usage: cpuMetric.nullable().optional(),
  js_heap_size: nonNegativeInteger.nullable().optional(),
  custom_metrics: z.record(z.string().max(128), z.number().finite()).nullable().optional(),
}).passthrough();
const metricBatchSchema = z.object({
  timestamp: dateTimeSchema,
  metrics: z.record(z.string().regex(/^\d{1,10}$/), metricPointSchema)
    .refine((metrics) => Object.keys(metrics).length <= 512),
}).passthrough();
const reportSchema = z.object({
  id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  created_at: dateTimeSchema,
  title: z.string().max(500).refine((value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)),
  metrics: z.array(metricBatchSchema).max(250_000).superRefine((batches, context) => {
    let pointCount = 0;
    for (const batch of batches) {
      pointCount += Object.keys(batch.metrics).length;
      if (pointCount > 500_000) {
        context.addIssue({ code: "custom", message: "Dataset exceeds the metric point limit." });
        return;
      }
    }
  }),
  analysis: z.record(z.string(), z.unknown()).nullable().optional(),
  meta: z.record(z.string(), z.unknown()).nullable().optional(),
}).passthrough();
const reportSelectionsSchema = z.record(
  z.string().regex(/^\d{1,16}$/),
  z.array(z.number().int().nonnegative().max(4_294_967_295)).max(512),
).refine((selections) => Object.keys(selections).length <= 500);
const comparisonContextSchema = z.object({
  baseline_original_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  cpu_selections_by_id: reportSelectionsSchema.optional(),
  mem_selections_by_id: reportSelectionsSchema.optional(),
}).passthrough();
const datasetSchema = z.object({
  schema_version: z.literal(1),
  exported_at: dateTimeSchema,
  report: reportSchema,
}).passthrough();
const comparisonBundleSchema = z.object({
  schema_version: z.literal(1),
  bundle_type: z.literal("comparison"),
  exported_at: dateTimeSchema,
  comparison_context: comparisonContextSchema.optional(),
  reports: z.array(reportSchema).min(2).max(500),
}).passthrough();
const compareRequestSchema = z.object({
  ids: z.array(z.string().uuid()).min(2).max(100),
}).strict();
const runIdSchema = z.string().uuid();

// ====================
// Helper Functions
// ====================
function extractRelease(meta?: ReportMeta | null): string | null {
  const tags = extractTags(meta);
  for (const tag of tags) {
    if (tag.startsWith("release:")) {
      return tag.slice(8);
    }
  }
  return null;
}

function extractPlatform(meta?: ReportMeta | null): string | null {
  const os = safeMetaString(meta?.env?.os, 80)?.toLowerCase() || "";
  if (os.includes("mac") || os.includes("darwin")) return "macos";
  if (os.includes("win")) return "windows";
  if (os.includes("linux")) return "linux";
  if (os.includes("chromeos")) return "chromeos";
  if (os.includes("android")) return "android";
  if (os.includes("ios")) return "ios";
  return os || null;
}

function safeMetaString(value: unknown, maxLength = 120): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.slice(0, maxLength * 2).trim().replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength);
  return normalized || null;
}

function sanitizeReport(report: ReportDetail): ReportDetail {
  const meta = report.meta;
  if (!meta) return report;
  if (!Array.isArray(meta.process_snapshot)) {
    return "process_snapshot" in meta
      ? { ...report, meta: { ...meta, process_snapshot: [] } }
      : report;
  }
  const processSnapshot = meta.process_snapshot.slice(0, 512).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const process = entry as Record<string, unknown>;
    if (typeof process.pid !== "number" || !Number.isSafeInteger(process.pid) || process.pid < 0) return [];
    const sanitized: { pid: number; name?: string; alias?: string; proc_type?: string } = { pid: process.pid };
    const name = safeMetaString(process.name, 120);
    const alias = safeMetaString(process.alias, 120);
    const processType = safeMetaString(process.proc_type, 40);
    if (name) sanitized.name = name;
    if (alias) sanitized.alias = alias;
    if (processType) sanitized.proc_type = processType;
    return [sanitized];
  });
  return { ...report, meta: { ...meta, process_snapshot: processSnapshot } };
}

function extractTags(meta?: ReportMeta | null): string[] {
  const rawTags = meta?.test_context?.tags;
  if (!Array.isArray(rawTags)) return [];
  return rawTags.slice(0, 100)
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => safeMetaString(tag, 120))
    .filter((tag): tag is string => tag !== null);
}

function extractClientId(meta?: ReportMeta | null): string | null {
  const candidate = meta?.source?.client_id;
  return typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

function extractDeviceName(meta?: ReportMeta | null): string | null {
  return safeMetaString(meta?.env?.device_name, 120);
}

function extractCampaignId(meta?: ReportMeta | null): string | null {
  for (const tag of extractTags(meta)) {
    const match = /^campaign:([a-z0-9._-]{1,80})$/i.exec(tag.trim());
    if (match) return match[1];
  }
  return null;
}

function createUploadKey(clientId: string, report: ReportDetail): string {
  return createHash("sha256")
    .update(`${clientId}:${report.id}:${new Date(report.created_at).toISOString()}`, "utf8")
    .digest("hex");
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
    const validation = datasetSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid dataset. Expected schema_version 1 and a valid report with bounded metrics." });
    }
    const parsedDataset = validation.data as unknown as ReportDatasetV1;
    const dataset: ReportDatasetV1 = {
      ...parsedDataset,
      report: sanitizeReport(parsedDataset.report),
    };

    const report = dataset.report;
    const meta = report.meta;
    const clientId = extractClientId(meta);
    const deviceName = extractDeviceName(meta);
    const campaignId = extractCampaignId(meta);
    const uploadKey = clientId ? createUploadKey(clientId, report) : null;

    // Stable source-aware key makes retries safe and allows different clients to reuse local IDs.
    const existingRun = uploadKey
      ? await prisma.run.findUnique({ where: { uploadKey } })
      : await prisma.run.findFirst({
          where: {
            originalId: report.id,
            reportDate: new Date(report.created_at),
          },
        });

    if (existingRun) {
      return res.status(200).json({
        success: true,
        duplicate: true,
        run: {
          id: existingRun.id,
          title: existingRun.title,
          createdAt: existingRun.createdAt,
          clientId: existingRun.clientId,
          deviceName: existingRun.deviceName,
          campaignId: existingRun.campaignId,
        },
      });
    }

    // Extract indexed fields
    const release = extractRelease(meta);
    const scenario = safeMetaString(meta?.test_context?.scenario_name);
    const buildId = safeMetaString(meta?.test_context?.build_id);
    const platform = extractPlatform(meta);
    const browser = safeMetaString(meta?.env?.browser_channel);
    const mode = safeMetaString(meta?.collection?.mode, 40);
    const tags = JSON.stringify(extractTags(meta));
    const rawDuration = meta?.collection?.duration_seconds;
    const durationSeconds = typeof rawDuration === "number" && Number.isSafeInteger(rawDuration) && rawDuration >= 0
      ? rawDuration
      : null;

    // Compute stats
    const stats = computeStats(report.metrics || []);

    // Store
    const runData = {
      originalId: report.id,
      title: report.title || `Report ${report.id}`,
      reportDate: new Date(report.created_at),
      release,
      scenario,
      buildId,
      platform,
      browser,
      mode,
      clientId,
      deviceName,
      campaignId,
      uploadKey,
      tags,
      durationSeconds,
      datasetJson: JSON.stringify(dataset),
      avgCpu: stats.avgCpu,
      avgMemMb: stats.avgMemMb,
      p95Cpu: stats.p95Cpu,
      p95MemMb: stats.p95MemMb,
    };
    const run = uploadKey
      ? await prisma.run.upsert({ where: { uploadKey }, create: runData, update: {} })
      : await prisma.run.create({ data: runData });

    console.log(`Uploaded run ${run.id}`);

    res.status(201).json({
      success: true,
      run: {
        id: run.id,
        title: run.title,
        createdAt: run.createdAt,
        clientId: run.clientId,
        deviceName: run.deviceName,
        campaignId: run.campaignId,
      },
    });
  } catch {
    console.error("Upload failed.");
    res.status(500).json({ error: "Upload failed." });
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
      campaignId,
      deviceName,
      limit = "50",
      offset = "0",
    } = req.query;

    const where: any = {};
    const filterText = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const normalized = value.trim();
      return normalized && normalized.length <= 120 ? normalized : null;
    };
    const releaseValue = filterText(release);
    const scenarioValue = filterText(scenario);
    const buildIdValue = filterText(buildId);
    const platformValue = filterText(platform);
    const tagsValue = filterText(tags);
    const campaignValue = filterText(campaignId);
    const deviceValue = filterText(deviceName);
    if (releaseValue) where.release = releaseValue;
    if (scenarioValue) where.scenario = { contains: scenarioValue };
    if (buildIdValue) where.buildId = { contains: buildIdValue };
    if (platformValue) where.platform = platformValue;
    if (tagsValue) where.tags = { contains: tagsValue };
    if (campaignValue) where.campaignId = { contains: campaignValue };
    if (deviceValue) where.deviceName = { contains: deviceValue };

    const parsedLimit = Number(limit);
    const parsedOffset = Number(offset);
    const safeLimit = Number.isInteger(parsedLimit) ? Math.max(1, Math.min(parsedLimit, 200)) : 50;
    const safeOffset = Number.isInteger(parsedOffset) ? Math.max(0, Math.min(parsedOffset, 1_000_000)) : 0;

    const runs = await prisma.run.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: safeLimit,
      skip: safeOffset,
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
        clientId: true,
        deviceName: true,
        campaignId: true,
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
      limit: safeLimit,
      offset: safeOffset,
    });
  } catch {
    console.error("List runs failed.");
    res.status(500).json({ error: "List runs failed." });
  }
});

/**
 * GET /api/v1/runs/:id
 * Get run detail (includes full dataset)
 */
apiRouter.get("/runs/:id", async (req, res) => {
  try {
    const parsedId = runIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: "Invalid run ID." });
    const id = parsedId.data;

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
      clientId: run.clientId,
      deviceName: run.deviceName,
      campaignId: run.campaignId,
      tags: JSON.parse(run.tags || "[]"),
      durationSeconds: run.durationSeconds,
      avgCpu: run.avgCpu,
      avgMemMb: run.avgMemMb,
      p95Cpu: run.p95Cpu,
      p95MemMb: run.p95MemMb,
      // Full report data from dataset
      report: dataset.report,
    });
  } catch {
    console.error("Get run failed.");
    res.status(500).json({ error: "Get run failed." });
  }
});

/**
 * DELETE /api/v1/runs/:id
 * Delete a run
 */
apiRouter.delete("/runs/:id", async (req, res) => {
  try {
    const parsedId = runIdSchema.safeParse(req.params.id);
    if (!parsedId.success) return res.status(400).json({ error: "Invalid run ID." });
    const id = parsedId.data;

    await prisma.run.delete({
      where: { id },
    });

    res.json({ success: true });
  } catch {
    console.error("Delete run failed.");
    res.status(500).json({ error: "Delete run failed." });
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
  } catch {
    console.error("Get tags failed.");
    res.status(500).json({ error: "Get tags failed." });
  }
});

/**
 * GET /api/v1/filters
 * Get available filter options (releases, scenarios, platforms, etc.)
 */
apiRouter.get("/filters", async (req, res) => {
  try {
    const [releases, scenarios, platforms, browsers, modes, devices, campaigns] = await Promise.all([
      prisma.run.findMany({ distinct: ["release"], where: { release: { not: null } }, select: { release: true } }),
      prisma.run.findMany({ distinct: ["scenario"], where: { scenario: { not: null } }, select: { scenario: true } }),
      prisma.run.findMany({ distinct: ["platform"], where: { platform: { not: null } }, select: { platform: true } }),
      prisma.run.findMany({ distinct: ["browser"], where: { browser: { not: null } }, select: { browser: true } }),
      prisma.run.findMany({ distinct: ["mode"], where: { mode: { not: null } }, select: { mode: true } }),
      prisma.run.findMany({ distinct: ["deviceName"], where: { deviceName: { not: null } }, select: { deviceName: true } }),
      prisma.run.findMany({ distinct: ["campaignId"], where: { campaignId: { not: null } }, select: { campaignId: true } }),
    ]);

    res.json({
      releases: releases.map((r) => r.release).filter(Boolean),
      scenarios: scenarios.map((r) => r.scenario).filter(Boolean),
      platforms: platforms.map((r) => r.platform).filter(Boolean),
      browsers: browsers.map((r) => r.browser).filter(Boolean),
      modes: modes.map((r) => r.mode).filter(Boolean),
      devices: devices.map((r) => r.deviceName).filter(Boolean),
      campaigns: campaigns.map((r) => r.campaignId).filter(Boolean),
    });
  } catch {
    console.error("Get filters failed.");
    res.status(500).json({ error: "Get filters failed." });
  }
});

/**
 * POST /api/v1/bundles
 * Import a comparison bundle (multiple reports + comparison context)
 */
apiRouter.post("/bundles", async (req, res) => {
  try {
    const bundleInput: unknown = req.body;
    const validation = comparisonBundleSchema.safeParse(bundleInput);
    if (!validation.success) {
      return res.status(400).json({ error: "Invalid comparison bundle." });
    }
    const bundle = validation.data;
    const reports = (bundle.reports as unknown as ReportDetail[]).map(sanitizeReport);

    const importedRuns: Array<{ id: string; originalId: number; title: string }> = [];
    const idMapping: Record<number, string> = {}; // originalId -> new server ID

    // Import each report
    for (const report of reports) {
      const meta = report.meta;
      const clientId = extractClientId(meta);
      const deviceName = extractDeviceName(meta);
      const campaignId = extractCampaignId(meta);
      const uploadKey = clientId ? createUploadKey(clientId, report) : null;

      // Check for existing import
      const existingRun = uploadKey
        ? await prisma.run.findUnique({ where: { uploadKey } })
        : await prisma.run.findFirst({
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
      const scenario = safeMetaString(meta?.test_context?.scenario_name);
      const buildId = safeMetaString(meta?.test_context?.build_id);
      const platform = extractPlatform(meta);
      const browser = safeMetaString(meta?.env?.browser_channel);
      const mode = safeMetaString(meta?.collection?.mode, 40);
      const tags = JSON.stringify(extractTags(meta));
      const rawDuration = meta?.collection?.duration_seconds;
      const durationSeconds = typeof rawDuration === "number" && Number.isSafeInteger(rawDuration) && rawDuration >= 0
        ? rawDuration
        : null;

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
          clientId,
          deviceName,
          campaignId,
          uploadKey,
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
    const comparisonContext = bundle.comparison_context ?? {};
    const baselineOriginalId = Number(comparisonContext.baseline_original_id);
    const newBaselineId = Number.isSafeInteger(baselineOriginalId)
      ? idMapping[baselineOriginalId] ?? null
      : null;

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
  } catch {
    console.error("Bundle import failed.");
    res.status(500).json({ error: "Bundle import failed." });
  }
});

/**
 * POST /api/v1/compare
 * Compare multiple runs
 */
apiRouter.post("/compare", async (req, res) => {
  try {
    const validation = compareRequestSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: "At least two valid run IDs are required." });
    }
    const { ids } = validation.data;

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
  } catch {
    console.error("Compare runs failed.");
    res.status(500).json({ error: "Compare runs failed." });
  }
});

