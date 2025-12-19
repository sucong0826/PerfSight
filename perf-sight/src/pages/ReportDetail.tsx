import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft,
  Loader,
  AlertTriangle,
  CheckCircle,
  Download,
  Trash2,
  Info,
  RotateCcw,
  Pencil,
  X,
  Save,
  Activity,
} from "lucide-react";
import { PerformanceCharts, ProcessInfo } from "../components/Charts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { buildReportPdfDataUri } from "../utils/bulkExport";

interface AnalysisReport {
  score: number;
  summary: {
    avg_cpu: number;
    max_cpu: number;
    p50_cpu?: number;
    p90_cpu?: number;
    p95_cpu: number;
    p99_cpu?: number;
    cpu_stddev?: number;
    cpu_high_ratio_30?: number;
    cpu_high_ratio_60?: number;
    avg_mem_mb: number;
    max_mem_mb: number;
    p50_mem_mb?: number;
    p90_mem_mb?: number;
    p95_mem_mb?: number;
    p99_mem_mb?: number;
    mem_stddev_mb?: number;
    mem_high_ratio_512mb?: number;
    mem_high_ratio_1024mb?: number;
    mem_growth_rate: number;
  };
  top_cpu?: Array<{
    pid: number;
    avg_cpu: number;
    cpu_share: number;
    avg_mem_mb: number;
    mem_share: number;
  }>;
  top_mem?: Array<{
    pid: number;
    avg_cpu: number;
    cpu_share: number;
    avg_mem_mb: number;
    mem_share: number;
  }>;
  insights: string[];
}

interface ReportDetailData {
  id: number;
  created_at: string;
  title: string;
  metrics: Array<{
    timestamp: string;
    metrics: { [pid: string]: any }; // Rust BatchMetric struct
  }>;
  analysis?: AnalysisReport;
  meta?: any;
}

const TipLabel: React.FC<{ label: string; tip?: string }> = ({
  label,
  tip,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="text-xs text-slate-500 mb-1 flex items-center gap-1"
    >
      <span>{label}</span>
      {tip ? (
        <div className="relative">
          <button
            type="button"
            className="text-slate-500 hover:text-slate-700 dark:text-slate-600 dark:hover:text-slate-400"
            title={tip}
            aria-label={`${label} info`}
            aria-expanded={open}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {open && (
            <div
              role="tooltip"
              className="absolute z-50 right-0 mt-2 w-[320px] max-w-[80vw] bg-white border border-slate-200 text-slate-900 rounded-lg p-3 shadow-xl dark:bg-slate-950 dark:border-slate-700 dark:text-slate-200"
            >
              <div className="text-xs leading-relaxed">{tip}</div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

const MetricLabel: React.FC<{ label: string; tip?: string }> = ({
  label,
  tip,
}) => {
  const [open, setOpen] = useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el) return;
      if (e.target instanceof Node && el.contains(e.target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="flex items-center gap-1 min-w-0">
      <span className="text-slate-500 truncate">{label}</span>
      {tip ? (
        <div className="relative shrink-0">
          <button
            type="button"
            className="text-slate-500 hover:text-slate-700 dark:text-slate-600 dark:hover:text-slate-400"
            title={tip}
            aria-label={`${label} info`}
            aria-expanded={open}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOpen((v) => !v);
            }}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
          {open && (
            <div
              role="tooltip"
              className="absolute z-50 left-0 mt-2 w-[320px] max-w-[80vw] bg-white border border-slate-200 text-slate-900 rounded-lg p-3 shadow-xl dark:bg-slate-950 dark:border-slate-700 dark:text-slate-200"
            >
              <div className="text-xs leading-relaxed">{tip}</div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export const ReportDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [report, setReport] = useState<ReportDetailData | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [hiddenPids, setHiddenPids] = useState<Set<number>>(new Set());
  const [detectedMode, setDetectedMode] = useState<"system" | "browser">(
    "system"
  );
  const [snapshotFilter, setSnapshotFilter] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [isSavingTitle, setIsSavingTitle] = useState(false);

  useEffect(() => {
    if (!id) return;
    invoke("get_report_detail", { id: parseInt(id) })
      .then((data: any) => {
        setReport(data);
        setTitleDraft(String(data?.title ?? ""));
        processData(data);
      })
      .catch(console.error);
  }, [id]);

  const handleSaveTitle = async () => {
    if (!report) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      alert("Title cannot be empty");
      return;
    }
    try {
      setIsSavingTitle(true);
      await invoke("update_report_title", { id: report.id, title: nextTitle });
      setReport({ ...report, title: nextTitle });
      setIsRenaming(false);
    } catch (e) {
      console.error("update_report_title failed", e);
      alert("Failed to save title");
    } finally {
      setIsSavingTitle(false);
    }
  };

  const processData = (data: ReportDetailData) => {
    const flattenedData: any[] = [];
    const foundPids = new Set<number>();
    const snapshotArr: any[] = Array.isArray(data.meta?.process_snapshot)
      ? data.meta.process_snapshot
      : [];
    const snapshotByPid = new Map<number, any>();
    snapshotArr.forEach((p) => {
      if (p && typeof p.pid === "number") snapshotByPid.set(p.pid, p);
    });

    // Flatten metrics for charts
    data.metrics.forEach((batch) => {
      // Some older reports (or websocket sources) may contain multiple batches with the same timestamp,
      // each holding a subset of PIDs. Merge adjacent same-timestamp rows to keep lines continuous.
      const last = flattenedData.length
        ? flattenedData[flattenedData.length - 1]
        : null;
      const point: any =
        last && last.timestamp === batch.timestamp
          ? last
          : { timestamp: batch.timestamp };
      Object.entries(batch.metrics).forEach(
        ([pidStr, metric]: [string, any]) => {
          const pid = parseInt(pidStr);
          foundPids.add(pid);
          point[`cpu_${pid}`] = metric.cpu_usage; // legacy primary
          point[`cpuos_${pid}`] = metric.cpu_os_usage ?? metric.cpu_usage;
          if (metric.cpu_chrome_usage != null)
            point[`cpuch_${pid}`] = metric.cpu_chrome_usage;
          point[`rss_${pid}`] = metric.memory_rss;
          if (metric.memory_private != null)
            point[`pmem_${pid}`] = metric.memory_private;
          if (metric.js_heap_size) point[`heap_${pid}`] = metric.js_heap_size;
          if (metric.gpu_usage) point[`gpu_${pid}`] = metric.gpu_usage;
          if (metric.custom_metrics) {
            Object.entries(metric.custom_metrics).forEach(([key, val]) => {
              const safeKey = key.replace(/[^a-zA-Z0-9]/g, "_");
              point[`custom_${safeKey}_${pid}`] = val;
            });
          }
        }
      );
      if (!(last && last.timestamp === batch.timestamp)) {
        flattenedData.push(point);
      }
    });
    setChartData(flattenedData);

    // Detect mode based on data
    const hasHeap = flattenedData.some((d) =>
      Object.keys(d).some((k) => k.startsWith("heap_"))
    );
    setDetectedMode(hasHeap ? "browser" : "system");

    // Build process list from meta.process_snapshot when available (for better labels + AI traceability).
    const procList: ProcessInfo[] = Array.from(foundPids).map((pid) => {
      const snap = snapshotByPid.get(pid);
      return {
        pid,
        alias: snap?.alias ?? undefined,
        name: snap?.name ?? `Process ${pid}`,
        proc_type: snap?.proc_type ?? "Unknown",
        title: snap?.title ?? undefined,
        url: snap?.url ?? undefined,
        cpu_usage: 0,
        memory_usage: 0,
      };
    });
    setProcesses(procList);
  };

  const perPidSummaries = React.useMemo(() => {
    if (!report?.metrics?.length) return [];
    const snapshotArr: any[] = Array.isArray(report.meta?.process_snapshot)
      ? report.meta.process_snapshot
      : [];
    const snapByPid = new Map<number, any>();
    snapshotArr.forEach((p) => {
      if (p && typeof p.pid === "number") snapByPid.set(p.pid, p);
    });

    const byPid = new Map<number, { cpu: number[]; memMb: number[] }>();

    report.metrics.forEach((batch: any) => {
      const m = batch?.metrics ?? {};
      Object.entries(m).forEach(([pidStr, metric]: any) => {
        const pid = Number(pidStr);
        if (!Number.isFinite(pid)) return;
        const cpu =
          typeof metric?.cpu_usage === "number" ? metric.cpu_usage : undefined;
        const mem =
          typeof metric?.memory_private === "number"
            ? metric.memory_private
            : typeof metric?.memory_footprint === "number"
            ? metric.memory_footprint
            : typeof metric?.memory_rss === "number"
            ? metric.memory_rss
            : undefined;
        if (!byPid.has(pid)) byPid.set(pid, { cpu: [], memMb: [] });
        const s = byPid.get(pid)!;
        if (typeof cpu === "number" && Number.isFinite(cpu)) s.cpu.push(cpu);
        if (typeof mem === "number" && Number.isFinite(mem))
          s.memMb.push(mem / 1024 / 1024);
      });
    });

    const percentile = (arr: number[], q: number) => {
      if (!arr.length) return undefined;
      const a = [...arr].sort((x, y) => x - y);
      const idx = Math.round((a.length - 1) * q);
      return a[Math.min(Math.max(idx, 0), a.length - 1)];
    };

    const avg = (arr: number[]) =>
      arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;

    const stddev = (arr: number[], mean: number) => {
      if (!arr.length) return undefined;
      const v =
        arr.reduce((acc, x) => acc + (x - mean) * (x - mean), 0) / arr.length;
      return Math.sqrt(v);
    };

    const linregSlope = (ys: number[]) => {
      // MB per sample (assumes constant interval)
      const n = ys.length;
      if (n <= 1) return 0;
      const sumX = ((n - 1) * n) / 2;
      let sumY = 0;
      let sumXY = 0;
      let sumXX = 0;
      for (let i = 0; i < n; i++) {
        const x = i;
        const y = ys[i];
        sumY += y;
        sumXY += x * y;
        sumXX += x * x;
      }
      const denom = n * sumXX - sumX * sumX;
      if (denom === 0) return 0;
      return (n * sumXY - sumX * sumY) / denom;
    };

    const out = Array.from(byPid.entries()).map(([pid, s]) => {
      const snap = snapByPid.get(pid);
      const avgCpu = avg(s.cpu);
      const maxCpu = s.cpu.length ? Math.max(...s.cpu) : undefined;
      const p50Cpu = percentile(s.cpu, 0.5);
      const p90Cpu = percentile(s.cpu, 0.9);
      const p95Cpu = percentile(s.cpu, 0.95);
      const p99Cpu = percentile(s.cpu, 0.99);
      const cpuStd = avgCpu != null ? stddev(s.cpu, avgCpu) : undefined;
      const cpuHigh30 = s.cpu.length
        ? s.cpu.filter((v) => v > 30).length / s.cpu.length
        : undefined;
      const cpuHigh60 = s.cpu.length
        ? s.cpu.filter((v) => v > 60).length / s.cpu.length
        : undefined;

      const avgMemMb = avg(s.memMb);
      const maxMemMb = s.memMb.length ? Math.max(...s.memMb) : undefined;
      const p50MemMb = percentile(s.memMb, 0.5);
      const p90MemMb = percentile(s.memMb, 0.9);
      const p95MemMb = percentile(s.memMb, 0.95);
      const p99MemMb = percentile(s.memMb, 0.99);
      const memStd = avgMemMb != null ? stddev(s.memMb, avgMemMb) : undefined;
      const memHigh512 = s.memMb.length
        ? s.memMb.filter((v) => v > 512).length / s.memMb.length
        : undefined;
      const memHigh1024 = s.memMb.length
        ? s.memMb.filter((v) => v > 1024).length / s.memMb.length
        : undefined;
      const memGrowth = linregSlope(s.memMb);
      return {
        pid,
        title: snap?.alias ?? snap?.title ?? snap?.name ?? `Process ${pid}`,
        proc_type: snap?.proc_type,
        avg_cpu: avgCpu,
        max_cpu: maxCpu,
        p50_cpu: p50Cpu,
        p90_cpu: p90Cpu,
        p95_cpu: p95Cpu,
        p99_cpu: p99Cpu,
        cpu_stddev: cpuStd,
        cpu_high_ratio_30: cpuHigh30,
        cpu_high_ratio_60: cpuHigh60,

        avg_mem_mb: avgMemMb,
        max_mem_mb: maxMemMb,
        p50_mem_mb: p50MemMb,
        p90_mem_mb: p90MemMb,
        p95_mem_mb: p95MemMb,
        p99_mem_mb: p99MemMb,
        mem_stddev_mb: memStd,
        mem_high_ratio_512mb: memHigh512,
        mem_high_ratio_1024mb: memHigh1024,
        mem_growth_rate: memGrowth,
      };
    });

    out.sort((a, b) => (b.avg_cpu ?? 0) - (a.avg_cpu ?? 0));
    return out;
  }, [report]);

  const customMetricSummaries = React.useMemo(() => {
    if (!report?.metrics?.length) return [];

    // Map<MetricName, Map<PID, number[]>>
    const dataMap = new Map<string, Map<number, number[]>>();

    report.metrics.forEach((batch) => {
      Object.entries(batch.metrics).forEach(
        ([pidStr, metric]: [string, any]) => {
          const pid = parseInt(pidStr, 10);
          if (metric.custom_metrics) {
            Object.entries(metric.custom_metrics).forEach(([key, val]) => {
              const name = key;
              const v = val as number;
              if (typeof v === "number") {
                if (!dataMap.has(name)) dataMap.set(name, new Map());
                const byPid = dataMap.get(name)!;
                if (!byPid.has(pid)) byPid.set(pid, []);
                byPid.get(pid)!.push(v);
              }
            });
          }
        }
      );
    });

    // Compute stats
    const results: Array<{
      name: string;
      rows: Array<{
        pid: number;
        min: number;
        max: number;
        avg: number;
        count: number;
      }>;
    }> = [];

    for (const [name, pidMap] of dataMap) {
      const rows = [];
      for (const [pid, values] of pidMap) {
        if (!values.length) continue;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const sum = values.reduce((a, b) => a + b, 0);
        const avg = sum / values.length;
        rows.push({ pid, min, max, avg, count: values.length });
      }
      results.push({ name, rows });
    }
    return results;
  }, [report]);

  if (!report) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-500">
        <Loader className="animate-spin w-6 h-6 mr-2" /> Loading...
      </div>
    );
  }

  const snapshotArr: any[] = Array.isArray(report.meta?.process_snapshot)
    ? report.meta.process_snapshot
    : [];
  const snapshotByPid = new Map<number, any>();
  snapshotArr.forEach((p) => {
    if (p && typeof p.pid === "number") snapshotByPid.set(p.pid, p);
  });

  const getScoreColor = (score: number) => {
    if (score >= 90) return "text-emerald-400";
    if (score >= 70) return "text-amber-400";
    return "text-rose-400";
  };

  const handleExport = async () => {
    if (!report) return;
    const report0 = report;

    const element = document.getElementById(
      "report-content"
    ) as HTMLElement | null;
    if (!element) return;

    try {
      setIsExporting(true);
      // Build a data-driven PDF (for bundling into ZIP) from report data.
      const pdfDataUri = await buildReportPdfDataUri({
        id: report0.id,
        created_at: report0.created_at,
        title: report0.title,
        metrics: report0.metrics,
        analysis: report0.analysis,
        meta: report0.meta,
      });

      const zipPath = (await invoke("export_reports_bundle_zip", {
        items: [{ report_id: report0.id, pdf_base64: pdfDataUri }],
        filename: null,
      })) as string;
      alert(`Exported ZIP:\n${zipPath}`);
      return;

      // Legacy exporter code (kept for reference). Ensure we have a stable local `report` binding for type-checking.
      const report = report0;

      // --- Page 1: Professional, text-based report ---
      const pdf = new jsPDF("p", "mm", "a4");
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const marginX = 14;
      const topY = 14;
      let y = topY;

      // White page, dark text (print-friendly).
      pdf.setTextColor(17, 24, 39); // slate-900

      const addSectionTitle = (t: string) => {
        y += 2;
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.text(t, marginX, y);
        y += 2;
        pdf.setDrawColor(203, 213, 225); // slate-300
        pdf.line(marginX, y, W - marginX, y);
        y += 6;
      };

      const addKV = (k: string, v: string) => {
        const keyW = 52;
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(71, 85, 105); // slate-600
        pdf.text(`${k}:`, marginX, y);
        pdf.setTextColor(17, 24, 39); // slate-900
        const lines = pdf.splitTextToSize(v || "—", W - marginX * 2 - keyW);
        pdf.text(lines, marginX + keyW, y);
        y += Math.max(5, lines.length * 5);
        if (y > H - 18) {
          pdf.addPage();
          y = topY;
        }
      };

      const fmtMaybe = (v: any) => (v == null || v === "" ? "—" : String(v));
      const createdAt = new Date(report.created_at).toLocaleString();
      const mode = fmtMaybe(report.meta?.collection?.mode ?? detectedMode);
      const durationSeconds = report.meta?.collection?.duration_seconds;
      const plannedSeconds = report.meta?.collection?.stop_after_seconds;

      const tc =
        report.meta?.test_context ??
        report.meta?.collection?.test_context ??
        {};

      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(18);
      pdf.setTextColor(17, 24, 39); // slate-900
      pdf.text("PerfSight Performance Report", marginX, y);
      y += 8;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(11);
      pdf.setTextColor(71, 85, 105); // slate-600
      pdf.text(`Report #${report.id}`, marginX, y);
      y += 8;

      addSectionTitle("Run Context");
      addKV("Title", fmtMaybe(report.title));
      addKV("Created", createdAt);
      addKV("Mode", mode);
      addKV(
        "Duration",
        typeof durationSeconds === "number" ? `${durationSeconds}s` : "—"
      );
      addKV(
        "Planned Duration",
        typeof plannedSeconds === "number"
          ? `${plannedSeconds}s (auto-stop)`
          : "—"
      );
      addKV("Scenario", fmtMaybe(tc?.scenario_name));
      addKV("Build ID", fmtMaybe(tc?.build_id));
      addKV("Tags", Array.isArray(tc?.tags) ? tc.tags.join(", ") : "—");
      addKV("Notes", fmtMaybe(tc?.notes));

      addSectionTitle("Per-Process Metrics (primary)");
      if (perPidSummaries.length === 0) {
        addKV("Processes", "—");
      } else {
        perPidSummaries.slice(0, 20).forEach((p) => {
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(11);
          pdf.setTextColor(17, 24, 39); // slate-900
          const header = `PID ${p.pid} — ${p.title}${
            p.proc_type ? ` (${p.proc_type})` : ""
          }`;
          const lines = pdf.splitTextToSize(header, W - marginX * 2);
          pdf.text(lines, marginX, y);
          y += lines.length * 5;
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10);
          pdf.setTextColor(17, 24, 39); // slate-900

          addKV(
            "CPU (avg/p95/p99/max)",
            `${p.avg_cpu != null ? p.avg_cpu.toFixed(1) : "—"}% / ${
              p.p95_cpu != null ? p.p95_cpu.toFixed(1) : "—"
            }% / ${p.p99_cpu != null ? p.p99_cpu.toFixed(1) : "—"}% / ${
              p.max_cpu != null ? p.max_cpu.toFixed(1) : "—"
            }%`
          );
          addKV(
            "CPU (p50/p90/stddev)",
            `${p.p50_cpu != null ? p.p50_cpu.toFixed(1) : "—"}% / ${
              p.p90_cpu != null ? p.p90_cpu.toFixed(1) : "—"
            }% / ${p.cpu_stddev != null ? p.cpu_stddev.toFixed(1) : "—"}`
          );
          addKV(
            "CPU >30% / >60%",
            `${
              p.cpu_high_ratio_30 != null
                ? (p.cpu_high_ratio_30 * 100).toFixed(0) + "%"
                : "—"
            } / ${
              p.cpu_high_ratio_60 != null
                ? (p.cpu_high_ratio_60 * 100).toFixed(0) + "%"
                : "—"
            }`
          );

          addKV(
            "Mem MB (avg/p95/p99/max)",
            `${p.avg_mem_mb != null ? p.avg_mem_mb.toFixed(0) : "—"} / ${
              p.p95_mem_mb != null ? p.p95_mem_mb.toFixed(0) : "—"
            } / ${p.p99_mem_mb != null ? p.p99_mem_mb.toFixed(0) : "—"} / ${
              p.max_mem_mb != null ? p.max_mem_mb.toFixed(0) : "—"
            }`
          );
          addKV(
            "Mem MB (p50/p90/stddev)",
            `${p.p50_mem_mb != null ? p.p50_mem_mb.toFixed(0) : "—"} / ${
              p.p90_mem_mb != null ? p.p90_mem_mb.toFixed(0) : "—"
            } / ${p.mem_stddev_mb != null ? p.mem_stddev_mb.toFixed(0) : "—"}`
          );
          addKV(
            "Mem >512MB / >1GB",
            `${
              p.mem_high_ratio_512mb != null
                ? (p.mem_high_ratio_512mb * 100).toFixed(0) + "%"
                : "—"
            } / ${
              p.mem_high_ratio_1024mb != null
                ? (p.mem_high_ratio_1024mb * 100).toFixed(0) + "%"
                : "—"
            }`
          );
          addKV(
            "Mem Growth (MB/s)",
            `${p.mem_growth_rate != null ? p.mem_growth_rate.toFixed(2) : "—"}`
          );

          y += 2;
        });
        if (perPidSummaries.length > 20) {
          addKV(
            "Note",
            `Only first 20 processes are included in the PDF text section (+${
              perPidSummaries.length - 20
            } more).`
          );
        }
      }

      addSectionTitle("Overall (avg only)");
      if (report.analysis?.summary) {
        const s = report.analysis?.summary as any;
        addKV("Avg CPU (total)", `${Number(s.avg_cpu).toFixed(1)}%`);
        addKV("Avg Memory (total)", `${Number(s.avg_mem_mb).toFixed(0)} MB`);
      } else {
        addKV("Summary", "— (no analysis available for this report)");
      }

      addSectionTitle("Insights");
      const insights: string[] = Array.isArray(report.analysis?.insights)
        ? (report.analysis?.insights as any)
        : [];
      if (insights.length === 0) {
        addKV("Result", "No issues detected.");
      } else {
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.setTextColor(226, 232, 240);
        insights.slice(0, 12).forEach((t) => {
          const lines = pdf.splitTextToSize(`• ${t}`, W - marginX * 2);
          pdf.text(lines, marginX, y);
          y += lines.length * 5;
          if (y > H - 18) {
            pdf.addPage();
            y = topY;
          }
        });
        if (insights.length > 12) {
          pdf.setTextColor(148, 163, 184);
          pdf.text(`(+${insights.length - 12} more)`, marginX, y);
          y += 6;
        }
      }

      // --- Appendix: charts/content snapshot as images (multi-page) ---
      pdf.addPage();
      y = topY;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(12);
      pdf.setTextColor(226, 232, 240);
      pdf.text("Appendix: Full Report Snapshot", marginX, y);
      y += 6;

      const canvas = await html2canvas(element as HTMLElement, {
        scale: 2,
        backgroundColor: "#020617",
        logging: false,
        useCORS: true,
      });

      const pageWidthMm = W - 20;
      const pageHeightMm = H - 20;
      const mmPerPx = pageWidthMm / canvas.width;
      const sliceHeightPx = Math.floor(pageHeightMm / mmPerPx);

      for (let offsetY = 0; offsetY < canvas.height; offsetY += sliceHeightPx) {
        const sliceCanvas = document.createElement("canvas");
        sliceCanvas.width = canvas.width;
        sliceCanvas.height = Math.min(sliceHeightPx, canvas.height - offsetY);
        const ctx = sliceCanvas.getContext("2d");
        if (!ctx) {
          break;
        }
        ctx!.drawImage(
          canvas,
          0,
          offsetY,
          canvas.width,
          sliceCanvas.height,
          0,
          0,
          canvas.width,
          sliceCanvas.height
        );
        const imgData = sliceCanvas.toDataURL("image/png");
        const sliceHeightMm = sliceCanvas.height * mmPerPx;
        pdf.addImage(imgData, "PNG", 10, 10, pageWidthMm, sliceHeightMm);
        if (offsetY + sliceHeightPx < canvas.height) pdf.addPage();
      }

      // Legacy single-PDF save path has been superseded by ZIP export above.
    } catch (err) {
      console.error("Export failed", err);
      alert("Failed to export ZIP");
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsDeleting(true);
      await invoke("delete_report", { id: report.id });
      navigate("/reports");
    } finally {
      setIsDeleting(false);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="p-8 h-screen flex flex-col bg-slate-50 text-slate-900 overflow-hidden dark:bg-slate-950 dark:text-slate-200">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/reports"
            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 dark:hover:bg-slate-900 dark:text-slate-400"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="min-w-0">
            {!isRenaming ? (
              <div className="flex items-center gap-2 min-w-0">
                <h1 className="text-xl font-bold truncate">{report.title}</h1>
                <button
                  type="button"
                  onClick={() => {
                    setTitleDraft(report.title || "");
                    setIsRenaming(true);
                  }}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                  title="Rename report title"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-[420px] max-w-[60vw] bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="Report title"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSaveTitle();
                    if (e.key === "Escape") {
                      setIsRenaming(false);
                      setTitleDraft(report.title || "");
                    }
                  }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={handleSaveTitle}
                  disabled={isSavingTitle}
                  className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white"
                  title="Save"
                >
                  <Save className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRenaming(false);
                    setTitleDraft(report.title || "");
                  }}
                  className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-200"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            to={`/retest/${report.id}`}
            className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg font-medium transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
            title="Re-test with this report's configuration"
          >
            <RotateCcw className="w-4 h-4" /> Re-test
          </Link>
          <button
            onClick={() => setConfirmDelete(true)}
            disabled={isDeleting}
            className="flex items-center gap-2 bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Download className="w-4 h-4" />{" "}
            {isExporting ? "Exporting…" : "Export…"}
          </button>
        </div>
      </div>

      <div id="report-content" className="flex-1 overflow-y-auto p-4">
        {confirmDelete && (
          <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center justify-between">
            <div className="text-sm text-rose-200">
              Delete this report (#{report.id})? This cannot be undone.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-sm bg-rose-600 hover:bg-rose-500 disabled:opacity-60"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        )}
        {/* Added ID and padding for capture */}
        {report.meta && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <div className="text-sm text-slate-500 uppercase font-bold mb-3">
              Metadata (for AI / reproducibility)
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 dark:bg-slate-950/50 dark:border-slate-800">
                <div className="text-xs text-slate-500 mb-2">Collection</div>
                <div className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">mode</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.collection?.mode ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">interval</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.collection?.interval_ms != null
                        ? `${report.meta.collection.interval_ms}ms`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">duration</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.collection?.duration_seconds != null
                        ? `${report.meta.collection.duration_seconds}s`
                        : "—"}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mt-2">
                    started: {report.meta?.collection?.started_at ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">
                    ended: {report.meta?.collection?.ended_at ?? "—"}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 dark:bg-slate-950/50 dark:border-slate-800">
                <div className="text-xs text-slate-500 mb-2">Environment</div>
                <div className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">os</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.os ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">os version</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.versions?.os_long_version ??
                        report.meta?.versions?.os_version ??
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">device</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.device_name ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">arch</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.arch ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">cpu</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.cpu_brand ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">cpu cores</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.cpu_logical_cores ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">cpu phys</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.cpu_physical_cores ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">total RAM</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.total_memory_bytes != null
                        ? `${Math.round(
                            report.meta.env.total_memory_bytes /
                              1024 /
                              1024 /
                              1024
                          )} GB`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">gpu</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.env?.gpu?.name ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">app</span>
                    <span className="tabular-nums text-slate-900 dark:text-slate-200">
                      {report.meta?.app?.version ?? "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 dark:bg-slate-950/50 dark:border-slate-800">
                <div className="text-xs text-slate-500 mb-2">Targets</div>
                <div className="text-xs text-slate-400">
                  {(report.meta?.collection?.target_pids ?? []).join(", ") ||
                    "—"}
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  process snapshot:{" "}
                  {(report.meta?.process_snapshot?.length ?? 0) > 0
                    ? `${report.meta.process_snapshot.length} processes`
                    : "—"}
                </div>
                <div className="mt-3 text-xs text-slate-500">
                  definitions:{" "}
                  <span className="text-slate-700 dark:text-slate-300">
                    system mem = RSS, browser mem = pmem→rss fallback
                  </span>
                </div>
              </div>
            </div>

            {report.meta?.test_context && (
              <div className="mt-4 bg-slate-50 border border-slate-200 rounded-lg p-3 dark:bg-slate-950/50 dark:border-slate-800">
                <div className="text-xs text-slate-500 mb-2">Test Context</div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Scenario</div>
                    <div className="text-slate-900 dark:text-slate-200">
                      {report.meta.test_context.scenario_name ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Build ID</div>
                    <div className="text-slate-900 tabular-nums dark:text-slate-200">
                      {report.meta.test_context.build_id ?? "—"}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="text-xs text-slate-500 mb-1">Tags</div>
                    <div className="text-slate-900 dark:text-slate-200">
                      {(report.meta.test_context.tags ?? []).join(", ") || "—"}
                    </div>
                  </div>
                  <div className="lg:col-span-4">
                    <div className="text-xs text-slate-500 mb-1">Notes</div>
                    <div className="text-slate-900 whitespace-pre-wrap dark:text-slate-200">
                      {report.meta.test_context.notes ?? "—"}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
        {report.analysis && (
          <div className="mb-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
            {/* Score Card */}
            <div className="bg-white border border-slate-200 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden dark:bg-slate-900 dark:border-slate-800">
              <div className="text-sm text-slate-500 uppercase font-bold mb-2">
                Performance Score
              </div>
              <div
                className={`text-5xl font-bold ${getScoreColor(
                  report.analysis.score
                )}`}
              >
                {report.analysis.score}
              </div>
              <div className="absolute top-0 right-0 p-2 opacity-10">
                {report.analysis.score >= 80 ? (
                  <CheckCircle className="w-24 h-24" />
                ) : (
                  <AlertTriangle className="w-24 h-24" />
                )}
              </div>
            </div>

            {/* Per-process metrics (primary) */}
            <div className="lg:col-span-3 bg-white border border-slate-200 p-5 rounded-xl dark:bg-slate-900 dark:border-slate-800">
              <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                Per-Process Metrics (primary)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {perPidSummaries.map((p) => (
                  <div
                    key={`proc_${p.pid}`}
                    className="bg-slate-50 border border-slate-200 rounded-lg p-4 dark:bg-slate-950/50 dark:border-slate-800"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div
                        className="text-sm font-medium truncate"
                        title={p.title}
                      >
                        {p.title}
                      </div>
                      <div className="text-xs text-slate-500 tabular-nums">
                        {p.pid}
                      </div>
                    </div>
                    <div className="text-xs text-slate-500 mb-3 truncate">
                      {p.proc_type ?? "—"}
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <div className="text-xs text-slate-500 font-semibold mb-2">
                          CPU
                        </div>
                        <div className="text-xs space-y-1">
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="avg"
                              tip="Mean of all CPU samples for this PID across the run."
                            />
                            <span className="tabular-nums text-right">
                              {p.avg_cpu != null
                                ? `${p.avg_cpu.toFixed(1)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="max"
                              tip="Maximum observed CPU% sample for this PID."
                            />
                            <span className="tabular-nums text-right">
                              {p.max_cpu != null
                                ? `${p.max_cpu.toFixed(1)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="p50 / p90"
                              tip="Median (p50) and p90 CPU%. Tail behavior indicator for this PID."
                            />
                            <span className="tabular-nums text-right">
                              {p.p50_cpu != null && p.p90_cpu != null
                                ? `${p.p50_cpu.toFixed(
                                    1
                                  )} / ${p.p90_cpu.toFixed(1)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="p95 / p99"
                              tip="p95 and p99 CPU%. Highlights rare CPU spikes (top 5% / 1% samples)."
                            />
                            <span className="tabular-nums text-right">
                              {p.p95_cpu != null && p.p99_cpu != null
                                ? `${p.p95_cpu.toFixed(
                                    1
                                  )} / ${p.p99_cpu.toFixed(1)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="stddev"
                              tip="Standard deviation of CPU samples. Higher means more volatility."
                            />
                            <span className="tabular-nums text-right">
                              {p.cpu_stddev != null
                                ? p.cpu_stddev.toFixed(1)
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label=">30% / >60%"
                              tip="Share of samples where CPU% is above 30% / 60% for this PID."
                            />
                            <span className="tabular-nums text-right">
                              {p.cpu_high_ratio_30 != null &&
                              p.cpu_high_ratio_60 != null
                                ? `${(p.cpu_high_ratio_30 * 100).toFixed(
                                    0
                                  )}% / ${(p.cpu_high_ratio_60 * 100).toFixed(
                                    0
                                  )}%`
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div>
                        <div className="text-xs text-slate-500 font-semibold mb-2">
                          Memory (MB)
                        </div>
                        <div className="text-xs space-y-1">
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="avg"
                              tip="Mean of all memory samples for this PID across the run (MB)."
                            />
                            <span className="tabular-nums text-right">
                              {p.avg_mem_mb != null
                                ? `${p.avg_mem_mb.toFixed(0)}`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="max"
                              tip="Maximum observed memory sample for this PID (MB)."
                            />
                            <span className="tabular-nums text-right">
                              {p.max_mem_mb != null
                                ? `${p.max_mem_mb.toFixed(0)}`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="p50 / p90"
                              tip="Median (p50) and p90 memory (MB). Helps assess tail memory behavior."
                            />
                            <span className="tabular-nums text-right">
                              {p.p50_mem_mb != null && p.p90_mem_mb != null
                                ? `${p.p50_mem_mb.toFixed(
                                    0
                                  )} / ${p.p90_mem_mb.toFixed(0)}`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="p95 / p99"
                              tip="p95 and p99 memory (MB). Highlights rare spikes (top 5% / 1% samples)."
                            />
                            <span className="tabular-nums text-right">
                              {p.p95_mem_mb != null && p.p99_mem_mb != null
                                ? `${p.p95_mem_mb.toFixed(
                                    0
                                  )} / ${p.p99_mem_mb.toFixed(0)}`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="stddev"
                              tip="Standard deviation of memory samples (MB). Higher means more volatility."
                            />
                            <span className="tabular-nums text-right">
                              {p.mem_stddev_mb != null
                                ? p.mem_stddev_mb.toFixed(0)
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label=">512 / >1024"
                              tip="Share of samples where memory exceeds 512MB / 1GB for this PID."
                            />
                            <span className="tabular-nums text-right">
                              {p.mem_high_ratio_512mb != null &&
                              p.mem_high_ratio_1024mb != null
                                ? `${(p.mem_high_ratio_512mb * 100).toFixed(
                                    0
                                  )}% / ${(
                                    p.mem_high_ratio_1024mb * 100
                                  ).toFixed(0)}%`
                                : "—"}
                            </span>
                          </div>
                          <div className="grid grid-cols-[1fr_auto] gap-3 items-baseline">
                            <MetricLabel
                              label="growth"
                              tip="Estimated memory growth rate (MB per second, approximated from linear regression over samples)."
                            />
                            <span className="tabular-nums text-right">
                              {p.mem_growth_rate != null
                                ? `${p.mem_growth_rate.toFixed(2)} MB/s`
                                : "—"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {perPidSummaries.length === 0 && (
                  <div className="text-sm text-slate-500 italic">
                    No per-process data found.
                  </div>
                )}
              </div>
            </div>

            {/* Overall (avg only) */}
            <div className="bg-white border border-slate-200 p-5 rounded-xl dark:bg-slate-900 dark:border-slate-800">
              <div className="text-xs text-slate-500 uppercase font-bold mb-3">
                Overall (avg only)
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <TipLabel
                    label="Avg CPU (total)"
                    tip="Average TOTAL CPU% across the run (sum of selected processes per sample, then averaged)."
                  />
                  <div className="text-xl font-medium">
                    {report.analysis.summary.avg_cpu.toFixed(1)}%
                  </div>
                </div>
                <div>
                  <TipLabel
                    label="Avg Memory (total)"
                    tip="Average TOTAL memory across the run (sum of selected processes per sample, then averaged)."
                  />
                  <div className="text-xl font-medium">
                    {report.analysis.summary.avg_mem_mb.toFixed(0)} MB
                  </div>
                </div>
              </div>
            </div>

            {/* Insights */}
            <div className="lg:col-span-3 bg-white border border-slate-200 p-5 rounded-xl overflow-y-auto max-h-[160px] custom-scrollbar dark:bg-slate-900 dark:border-slate-800">
              <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                Insights
              </div>
              {report.analysis.insights.length === 0 ? (
                <div className="text-sm text-slate-500 italic">
                  No issues detected. Good job!
                </div>
              ) : (
                <ul className="space-y-2">
                  {report.analysis.insights.map((insight, i) => (
                    <li
                      key={i}
                      className="text-sm text-rose-700 flex gap-2 items-start dark:text-rose-300"
                    >
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{insight}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {report.analysis &&
          ((report.analysis.top_cpu && report.analysis.top_cpu.length > 0) ||
            (report.analysis.top_mem &&
              report.analysis.top_mem.length > 0)) && (
            <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-slate-200 p-5 rounded-xl dark:bg-slate-900 dark:border-slate-800">
                <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                  Top CPU Contributors
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                        <th className="text-left py-2 pr-3">PID</th>
                        <th className="text-left py-2 px-3">Process</th>
                        <th className="text-right py-2 px-3">Avg CPU</th>
                        <th className="text-right py-2 pl-3">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.analysis.top_cpu || []).map((c) => (
                        <tr
                          key={`cpu_${c.pid}`}
                          className="border-b border-slate-200 hover:bg-slate-50 cursor-pointer dark:border-slate-800/50 dark:hover:bg-slate-950/50"
                          onClick={() => {
                            const next = new Set(hiddenPids);
                            if (next.has(c.pid)) next.delete(c.pid);
                            else next.add(c.pid);
                            setHiddenPids(next);
                          }}
                          title="Click to toggle this PID visibility in charts"
                        >
                          <td className="py-2 pr-3 text-slate-900 tabular-nums dark:text-slate-200">
                            {c.pid}
                          </td>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-200">
                            <div className="truncate max-w-[260px]">
                              {snapshotByPid.get(c.pid)?.alias ||
                                snapshotByPid.get(c.pid)?.title ||
                                snapshotByPid.get(c.pid)?.name ||
                                `Process ${c.pid}`}
                            </div>
                            <div className="text-xs text-slate-500">
                              {snapshotByPid.get(c.pid)?.proc_type || "—"}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {c.avg_cpu.toFixed(1)}%
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {(c.cpu_share * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-white border border-slate-200 p-5 rounded-xl dark:bg-slate-900 dark:border-slate-800">
                <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                  Top Memory Contributors
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                        <th className="text-left py-2 pr-3">PID</th>
                        <th className="text-left py-2 px-3">Process</th>
                        <th className="text-right py-2 px-3">Avg Mem</th>
                        <th className="text-right py-2 pl-3">Share</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(report.analysis.top_mem || []).map((c) => (
                        <tr
                          key={`mem_${c.pid}`}
                          className="border-b border-slate-200 hover:bg-slate-50 cursor-pointer dark:border-slate-800/50 dark:hover:bg-slate-950/50"
                          onClick={() => {
                            const next = new Set(hiddenPids);
                            if (next.has(c.pid)) next.delete(c.pid);
                            else next.add(c.pid);
                            setHiddenPids(next);
                          }}
                          title="Click to toggle this PID visibility in charts"
                        >
                          <td className="py-2 pr-3 text-slate-900 tabular-nums dark:text-slate-200">
                            {c.pid}
                          </td>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-200">
                            <div className="truncate max-w-[260px]">
                              {snapshotByPid.get(c.pid)?.alias ||
                                snapshotByPid.get(c.pid)?.title ||
                                snapshotByPid.get(c.pid)?.name ||
                                `Process ${c.pid}`}
                            </div>
                            <div className="text-xs text-slate-500">
                              {snapshotByPid.get(c.pid)?.proc_type || "—"}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {c.avg_mem_mb.toFixed(0)} MB
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums text-slate-600 dark:text-slate-300">
                            {(c.mem_share * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        {customMetricSummaries.length > 0 && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <div className="text-sm text-slate-500 uppercase font-bold mb-3">
              Log Extracted Metrics
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {customMetricSummaries.map((m) => (
                <div
                  key={m.name}
                  className="bg-slate-50 border border-slate-200 rounded-lg p-4 dark:bg-slate-950/50 dark:border-slate-800"
                >
                  <div className="font-medium mb-3 flex items-center gap-2">
                    <Activity className="w-4 h-4 text-indigo-500" /> {m.name}
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800">
                        <th className="text-left py-1 pr-2">PID</th>
                        <th className="text-right py-1 px-2">Avg</th>
                        <th className="text-right py-1 px-2">Min</th>
                        <th className="text-right py-1 pl-2">Max</th>
                      </tr>
                    </thead>
                    <tbody>
                      {m.rows.map((r) => (
                        <tr
                          key={r.pid}
                          className="border-b border-slate-200 last:border-0 dark:border-slate-800/50"
                        >
                          <td className="py-1.5 pr-2 tabular-nums">
                            {r.pid === 0 ? (
                              "App Logs"
                            ) : (
                              <span title={`PID ${r.pid}`}>
                                {snapshotByPid.get(r.pid)?.alias || r.pid}
                              </span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums font-medium">
                            {r.avg.toFixed(2)}
                          </td>
                          <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">
                            {r.min.toFixed(2)}
                          </td>
                          <td className="py-1.5 pl-2 text-right tabular-nums text-slate-500">
                            {r.max.toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}

        {snapshotArr.length > 0 && (
          <div className="mb-6 bg-white border border-slate-200 rounded-xl p-5 dark:bg-slate-900 dark:border-slate-800">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-500 uppercase font-bold">
                Process Snapshot
              </div>
              <input
                value={snapshotFilter}
                onChange={(e) => setSnapshotFilter(e.target.value)}
                className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 w-[320px] dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                placeholder="Search pid/alias/name/title/url/type…"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left py-2 pr-3">PID</th>
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-left py-2 px-3">Title / Name</th>
                    <th className="text-left py-2 pl-3">URL</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshotArr
                    .filter((p) => {
                      const q = snapshotFilter.trim().toLowerCase();
                      if (!q) return true;
                      const hay = [
                        String(p?.pid ?? ""),
                        String(p?.proc_type ?? ""),
                        String(p?.alias ?? ""),
                        String(p?.title ?? ""),
                        String(p?.name ?? ""),
                        String(p?.url ?? ""),
                      ]
                        .join(" ")
                        .toLowerCase();
                      return hay.includes(q);
                    })
                    .slice(0, 200)
                    .map((p) => (
                      <tr
                        key={`snap_${p.pid}`}
                        className="border-b border-slate-200 hover:bg-slate-50 cursor-pointer dark:border-slate-800/50 dark:hover:bg-slate-950/50"
                        onClick={() => {
                          const pid = p.pid as number;
                          const next = new Set(hiddenPids);
                          if (next.has(pid)) next.delete(pid);
                          else next.add(pid);
                          setHiddenPids(next);
                        }}
                        title="Click to toggle this PID visibility in charts"
                      >
                        <td className="py-2 pr-3 text-slate-900 tabular-nums dark:text-slate-200">
                          {p.pid}
                        </td>
                        <td className="py-2 px-3 text-slate-900 dark:text-slate-200">
                          {p.proc_type ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-slate-900 dark:text-slate-200">
                          <div className="truncate max-w-[420px]">
                            {p.alias ?? p.title ?? p.name ?? `Process ${p.pid}`}
                          </div>
                        </td>
                        <td className="py-2 pl-3 text-slate-600 dark:text-slate-400">
                          <div className="truncate max-w-[520px]">
                            {p.url ?? "—"}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {snapshotArr.length > 200 && (
                <div className="text-xs text-slate-500 mt-2">
                  Showing first 200 rows (use search to narrow).
                </div>
              )}
            </div>
          </div>
        )}
        <PerformanceCharts
          data={chartData}
          selectedProcesses={processes}
          hiddenPids={hiddenPids}
          onToggleVisibility={(pid) => {
            const next = new Set(hiddenPids);
            if (next.has(pid)) next.delete(pid);
            else next.add(pid);
            setHiddenPids(next);
          }}
          mode={detectedMode}
          metricStandard={detectedMode === "browser" ? "chrome" : "os"}
        />
      </div>
    </div>
  );
};

