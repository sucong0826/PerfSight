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
} from "lucide-react";
import { PerformanceCharts, ProcessInfo } from "../components/Charts";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

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
            className="text-slate-600 hover:text-slate-400"
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
              className="absolute z-50 right-0 mt-2 w-[320px] max-w-[80vw] bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-3 shadow-xl"
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
            className="text-slate-600 hover:text-slate-400"
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
              className="absolute z-50 left-0 mt-2 w-[320px] max-w-[80vw] bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-3 shadow-xl"
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

  useEffect(() => {
    if (!id) return;
    invoke("get_report_detail", { id: parseInt(id) })
      .then((data: any) => {
        setReport(data);
        processData(data);
      })
      .catch(console.error);
  }, [id]);

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
        title: snap?.title ?? snap?.name ?? `Process ${pid}`,
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
    const element = document.getElementById("report-content");
    if (!element) return;

    try {
      setIsExporting(true);
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
        const s = report.analysis.summary as any;
        addKV("Avg CPU (total)", `${Number(s.avg_cpu).toFixed(1)}%`);
        addKV("Avg Memory (total)", `${Number(s.avg_mem_mb).toFixed(0)} MB`);
      } else {
        addKV("Summary", "— (no analysis available for this report)");
      }

      addSectionTitle("Insights");
      const insights: string[] = Array.isArray(report.analysis?.insights)
        ? report.analysis!.insights
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

      const canvas = await html2canvas(element, {
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
        if (!ctx) break;
        ctx.drawImage(
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

      const dataUri = pdf.output("datauristring");
      try {
        // In Tauri, browser-style downloads may be blocked. Always try native save first.
        const savedPath = (await invoke("export_report_pdf", {
          reportId: report.id,
          filename: `PerfSight_Report_${report.id}.pdf`,
          pdfBase64: dataUri,
        })) as string;
        alert(`PDF saved:\n${savedPath}`);
      } catch (e) {
        console.error(
          "Native PDF save failed; falling back to browser download",
          e
        );
        pdf.save(`PerfSight_Report_${report.id}.pdf`);
      }
    } catch (err) {
      console.error("Export failed", err);
      alert("Failed to export PDF");
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
    <div className="p-8 h-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div className="flex items-center gap-4">
          <Link
            to="/reports"
            className="p-2 hover:bg-slate-900 rounded-lg text-slate-400"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h1 className="text-xl font-bold">{report.title}</h1>
        </div>
        <div className="flex items-center gap-3">
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
            {isExporting ? "Exporting…" : "Export PDF"}
          </button>
          <button
            onClick={async () => {
              try {
                const saved = (await invoke("export_report_dataset", {
                  reportId: report.id,
                })) as string;
                alert(`Dataset saved:\n${saved}`);
              } catch (e) {
                console.error("Export dataset failed", e);
                alert("Failed to export dataset");
              }
            }}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <Download className="w-4 h-4" /> Export Dataset
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
                className="px-3 py-1.5 rounded-md text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
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
          <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="text-sm text-slate-500 uppercase font-bold mb-3">
              Metadata (for AI / reproducibility)
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
              <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-2">Collection</div>
                <div className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">mode</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.collection?.mode ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">interval</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.collection?.interval_ms != null
                        ? `${report.meta.collection.interval_ms}ms`
                        : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">duration</span>
                    <span className="tabular-nums text-slate-200">
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

              <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-2">Environment</div>
                <div className="space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">os</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.env?.os ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">os version</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.versions?.os_long_version ??
                        report.meta?.versions?.os_version ??
                        "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">arch</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.env?.arch ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">cpu cores</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.env?.cpu_logical_cores ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-400">total RAM</span>
                    <span className="tabular-nums text-slate-200">
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
                    <span className="text-slate-400">app</span>
                    <span className="tabular-nums text-slate-200">
                      {report.meta?.app?.version ?? "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950/50 border border-slate-800 rounded-lg p-3">
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
                  <span className="text-slate-300">
                    system mem = RSS, browser mem = pmem→rss fallback
                  </span>
                </div>
              </div>
            </div>

            {report.meta?.test_context && (
              <div className="mt-4 bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                <div className="text-xs text-slate-500 mb-2">Test Context</div>
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-3 text-sm">
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Scenario</div>
                    <div className="text-slate-200">
                      {report.meta.test_context.scenario_name ?? "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-500 mb-1">Build ID</div>
                    <div className="text-slate-200 tabular-nums">
                      {report.meta.test_context.build_id ?? "—"}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="text-xs text-slate-500 mb-1">Tags</div>
                    <div className="text-slate-200">
                      {(report.meta.test_context.tags ?? []).join(", ") || "—"}
                    </div>
                  </div>
                  <div className="lg:col-span-4">
                    <div className="text-xs text-slate-500 mb-1">Notes</div>
                    <div className="text-slate-200 whitespace-pre-wrap">
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
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden">
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
            <div className="lg:col-span-3 bg-slate-900 border border-slate-800 p-5 rounded-xl">
              <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                Per-Process Metrics (primary)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {perPidSummaries.map((p) => (
                  <div
                    key={`proc_${p.pid}`}
                    className="bg-slate-950/50 border border-slate-800 rounded-lg p-4"
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
            <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
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
            <div className="lg:col-span-3 bg-slate-900 border border-slate-800 p-5 rounded-xl overflow-y-auto max-h-[160px] custom-scrollbar">
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
                      className="text-sm text-rose-300 flex gap-2 items-start"
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
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                  Top CPU Contributors
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b border-slate-800">
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
                          className="border-b border-slate-800/50 hover:bg-slate-950/50 cursor-pointer"
                          onClick={() => {
                            const next = new Set(hiddenPids);
                            if (next.has(c.pid)) next.delete(c.pid);
                            else next.add(c.pid);
                            setHiddenPids(next);
                          }}
                          title="Click to toggle this PID visibility in charts"
                        >
                          <td className="py-2 pr-3 text-slate-200 tabular-nums">
                            {c.pid}
                          </td>
                          <td className="py-2 px-3 text-slate-200">
                            <div className="truncate max-w-[260px]">
                              {snapshotByPid.get(c.pid)?.title ||
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
                          <td className="py-2 pl-3 text-right tabular-nums text-slate-300">
                            {(c.cpu_share * 100).toFixed(0)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                  Top Memory Contributors
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b border-slate-800">
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
                          className="border-b border-slate-800/50 hover:bg-slate-950/50 cursor-pointer"
                          onClick={() => {
                            const next = new Set(hiddenPids);
                            if (next.has(c.pid)) next.delete(c.pid);
                            else next.add(c.pid);
                            setHiddenPids(next);
                          }}
                          title="Click to toggle this PID visibility in charts"
                        >
                          <td className="py-2 pr-3 text-slate-200 tabular-nums">
                            {c.pid}
                          </td>
                          <td className="py-2 px-3 text-slate-200">
                            <div className="truncate max-w-[260px]">
                              {snapshotByPid.get(c.pid)?.title ||
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
                          <td className="py-2 pl-3 text-right tabular-nums text-slate-300">
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

        {snapshotArr.length > 0 && (
          <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="text-sm text-slate-500 uppercase font-bold">
                Process Snapshot
              </div>
              <input
                value={snapshotFilter}
                onChange={(e) => setSnapshotFilter(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-200 w-[320px]"
                placeholder="Search pid/name/title/url/type…"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-800">
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
                        className="border-b border-slate-800/50 hover:bg-slate-950/50 cursor-pointer"
                        onClick={() => {
                          const pid = p.pid as number;
                          const next = new Set(hiddenPids);
                          if (next.has(pid)) next.delete(pid);
                          else next.add(pid);
                          setHiddenPids(next);
                        }}
                        title="Click to toggle this PID visibility in charts"
                      >
                        <td className="py-2 pr-3 text-slate-200 tabular-nums">
                          {p.pid}
                        </td>
                        <td className="py-2 px-3 text-slate-200">
                          {p.proc_type ?? "—"}
                        </td>
                        <td className="py-2 px-3 text-slate-200">
                          <div className="truncate max-w-[420px]">
                            {p.title ?? p.name ?? `Process ${p.pid}`}
                          </div>
                        </td>
                        <td className="py-2 pl-3 text-slate-400">
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

