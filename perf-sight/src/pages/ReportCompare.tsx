import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Loader, GitCompare, AlertTriangle, TrendingUp, TrendingDown, Download } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush 
} from 'recharts';
import { useTheme } from "../theme";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

interface AnalysisSummary {
  avg_cpu: number;
  p95_cpu: number;
  p99_cpu?: number;
  cpu_high_ratio_60?: number;
  avg_mem_mb: number;
  p95_mem_mb?: number;
  p99_mem_mb?: number;
  mem_high_ratio_1024mb?: number;
  mem_growth_rate: number;
}

interface AnalysisReport {
  score: number;
  summary: AnalysisSummary;
  insights: string[];
}

interface ReportDetailData {
  id: number;
  title: string;
  created_at: string;
  metrics: Array<{
    timestamp: string;
    metrics: { [pid: string]: any } 
  }>;
  analysis?: AnalysisReport;
  meta?: any;
}

const COLORS = {
  BASELINE: "#6366f1", // indigo-500
  PALETTE: [
    "#f59e0b", // amber-500
    "#10b981", // emerald-500
    "#06b6d4", // cyan-500
    "#8b5cf6", // violet-500
    "#ef4444", // red-500
    "#ec4899", // pink-500
  ],
};

type MetricTab = "cpu" | "mem";

type ProcItem = {
  pid: number;
  label: string;
  proc_type?: string;
};

const uniqPids = (arr: number[]) => Array.from(new Set(arr.filter((n) => Number.isFinite(n))));

const extractProcItems = (r: ReportDetailData | undefined | null): ProcItem[] => {
  if (!r) return [];
  const snap: any[] = Array.isArray(r.meta?.process_snapshot) ? r.meta.process_snapshot : [];
  if (snap.length) {
    return snap
      .filter((p) => p && typeof p.pid === "number")
      .map((p) => ({
        pid: p.pid as number,
        label: String(p.alias ?? p.title ?? p.name ?? `PID ${p.pid}`),
        proc_type: p.proc_type ? String(p.proc_type) : undefined,
      }));
  }
  // Fallback: infer from metric keys
  const seen: number[] = [];
  (r.metrics ?? []).forEach((b: any) => {
    const m = b?.metrics ?? {};
    Object.keys(m).forEach((pidStr) => {
      const pid = Number(pidStr);
      if (Number.isFinite(pid)) seen.push(pid);
    });
  });
  return uniqPids(seen).map((pid) => ({ pid, label: `PID ${pid}` }));
};

export const ReportCompare: React.FC = () => {
  const [searchParams] = useSearchParams();
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const gridStroke = isDark ? "#1e293b" : "#e2e8f0";
  const axisStroke = isDark ? "#475569" : "#94a3b8";
  const tickFill = isDark ? "#94a3b8" : "#64748b";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportDetailData[]>([]);
  const [tab, setTab] = useState<MetricTab>("cpu");
  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [cpuSelById, setCpuSelById] = useState<Record<number, number[]>>({});
  const [memSelById, setMemSelById] = useState<Record<number, number[]>>({});
  const [isExporting, setIsExporting] = useState(false);

  const maxCompare = 6;

  useEffect(() => {
    const idsRaw = searchParams.get("ids") ?? "";
    const ids = idsRaw
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n));
    const uniq = Array.from(new Set(ids)).slice(0, maxCompare);
    if (uniq.length < 2) {
      setError("Please select at least two reports to compare.");
      setLoading(false);
      return;
    }
    loadReports(uniq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadReports = async (ids: number[]) => {
    try {
      setLoading(true);
      const results = (await Promise.all(
        ids.map((id) => invoke("get_report_detail", { id }))
      )) as ReportDetailData[];
      setReports(results);

      // Default baseline: first selected report.
      setBaselineId(results[0]?.id ?? null);

      // Initialize selections to "all PIDs" per report, per metric.
      const nextCpu: Record<number, number[]> = {};
      const nextMem: Record<number, number[]> = {};
      results.forEach((r) => {
        const pids = extractProcItems(r).map((p) => p.pid);
        nextCpu[r.id] = pids;
        nextMem[r.id] = pids;
      });
      setCpuSelById(nextCpu);
      setMemSelById(nextMem);
      setError(null);
      setLoading(false);
    } catch (e: any) {
      setError("Failed to load reports: " + e.toString());
      setLoading(false);
    }
  };

  const tooltipStyle = {
    backgroundColor: isDark ? "#0f172a" : "#ffffff",
    borderColor: isDark ? "#334155" : "#e2e8f0",
    color: isDark ? "#f1f5f9" : "#0f172a",
  } as const;

  const fmtPct = (v?: number) =>
    typeof v === "number" ? `${v.toFixed(1)}%` : "—";
  const fmtMb = (v?: number) =>
    typeof v === "number" ? `${v.toFixed(0)} MB` : "—";

  const deltaBadge = (delta: number, worseWhenHigher = true) => {
    const worse = worseWhenHigher ? delta > 0 : delta < 0;
    const cls = worse
      ? "text-rose-300 bg-rose-500/10 border-rose-500/30"
      : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
    const Icon = worse ? TrendingUp : TrendingDown;
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${cls}`}
      >
        <Icon className="w-3.5 h-3.5" />
        {delta > 0 ? "+" : ""}
        {delta.toFixed(1)}
      </span>
    );
  };

  const sumSelected = (
    point: any,
    selectedArr: number[] | undefined,
    pick: (m: any) => number | undefined
  ) => {
    const selected = new Set(selectedArr ?? []);
    if (!selected.size) return null;
    if (!point?.metrics) return null;
    let total = 0;
    for (const [pidStr, m] of Object.entries(point.metrics)) {
      const pid = Number(pidStr);
      if (!Number.isFinite(pid)) continue;
      if (!selected.has(pid)) continue;
      const v = pick(m);
      if (typeof v === "number" && Number.isFinite(v)) total += v;
    }
    return total;
  };

  const finite = (arr: Array<number | null | undefined>) =>
    arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;

  const percentile = (arr: number[], q: number) => {
    if (!arr.length) return undefined;
    const a = [...arr].sort((x, y) => x - y);
    const idx = Math.round((a.length - 1) * q);
    return a[Math.min(Math.max(idx, 0), a.length - 1)];
  };

  const linregSlope = (xs: number[], ys: number[]) => {
    if (xs.length !== ys.length || xs.length < 2) return undefined;
    const n = xs.length;
    const xAvg = xs.reduce((s, v) => s + v, 0) / n;
    const yAvg = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - xAvg;
      num += dx * (ys[i] - yAvg);
      den += dx * dx;
    }
    if (den === 0) return undefined;
    return num / den;
  };

  const snapByPid = (r: ReportDetailData) => {
    const snap: any[] = Array.isArray(r.meta?.process_snapshot) ? r.meta.process_snapshot : [];
    const m = new Map<number, any>();
    snap.forEach((p) => {
      const pid = Number(p?.pid);
      if (Number.isFinite(pid)) m.set(pid, p);
    });
    return m;
  };

  const pidLabel = (r: ReportDetailData, pid: number) => {
    const s = snapByPid(r).get(pid);
    const base = String(s?.alias ?? s?.title ?? s?.name ?? `PID ${pid}`);
    return `${base} (${pid})`;
  };

  const alignedData = useMemo(() => {
    if (reports.length < 2) return [];
    const baseline =
      baselineId != null ? reports.find((r) => r.id === baselineId) : null;
    const baseIntervalMs =
      baseline?.meta?.collection?.interval_ms ??
      reports[0]?.meta?.collection?.interval_ms ??
      1000;
    const maxLen = Math.max(...reports.map((r) => r.metrics.length));
    const out: any[] = [];
    for (let i = 0; i < maxLen; i++) {
      const row: any = { time_s: (i * baseIntervalMs) / 1000 };
      for (const r of reports) {
        const point = r.metrics[i];
        row[`cpu_${r.id}`] = sumSelected(point, cpuSelById[r.id], (m) => m?.cpu_usage);
        row[`mem_${r.id}`] = sumSelected(
          point,
          memSelById[r.id],
          (m) => m?.memory_private ?? m?.memory_footprint ?? m?.memory_rss
        );
      }
      out.push(row);
    }
    return out;
  }, [reports, cpuSelById, memSelById]);

  const perPidSummariesById = useMemo(() => {
    const out: Record<
      number,
      Array<{
        pid: number;
        label: string;
        proc_type?: string;
        cpu_selected: boolean;
        mem_selected: boolean;
        cpu_avg?: number;
        cpu_p95?: number;
        cpu_p99?: number;
        mem_avg_mb?: number;
        mem_p95_mb?: number;
        mem_p99_mb?: number;
        mem_growth_mb_s?: number;
      }>
    > = {};

    for (const r of reports) {
      const cpuSel = new Set(cpuSelById[r.id] ?? []);
      const memSel = new Set(memSelById[r.id] ?? []);
      const union = Array.from(new Set([...(cpuSelById[r.id] ?? []), ...(memSelById[r.id] ?? [])]));
      const snap = snapByPid(r);

      const byPid = new Map<number, { cpu: number[]; memMb: number[]; memT: number[] }>();
      const intervalMs = Number(r.meta?.collection?.interval_ms ?? 1000);

      (r.metrics ?? []).forEach((batch: any, idx: number) => {
        const t = (idx * intervalMs) / 1000;
        const m = batch?.metrics ?? {};
        union.forEach((pid) => {
          const metric = m[String(pid)];
          if (!metric) return;
          const cpu = typeof metric?.cpu_usage === "number" ? metric.cpu_usage : undefined;
          const mem =
            typeof metric?.memory_private === "number"
              ? metric.memory_private
              : typeof metric?.memory_footprint === "number"
              ? metric.memory_footprint
              : typeof metric?.memory_rss === "number"
              ? metric.memory_rss
              : undefined;
          if (!byPid.has(pid)) byPid.set(pid, { cpu: [], memMb: [], memT: [] });
          const s = byPid.get(pid)!;
          if (cpuSel.has(pid) && typeof cpu === "number" && Number.isFinite(cpu)) s.cpu.push(cpu);
          if (memSel.has(pid) && typeof mem === "number" && Number.isFinite(mem)) {
            s.memMb.push(mem / 1024 / 1024);
            s.memT.push(t);
          }
        });
      });

      const rows = union.map((pid) => {
        const s = byPid.get(pid) ?? { cpu: [], memMb: [], memT: [] };
        const cpuAvg = avg(s.cpu);
        const memAvg = avg(s.memMb);
        const slope = s.memMb.length >= 2 ? linregSlope(s.memT, s.memMb) : undefined;
        return {
          pid,
          label: pidLabel(r, pid),
          proc_type: snap.get(pid)?.proc_type ? String(snap.get(pid)?.proc_type) : undefined,
          cpu_selected: cpuSel.has(pid),
          mem_selected: memSel.has(pid),
          cpu_avg: cpuAvg,
          cpu_p95: percentile(s.cpu, 0.95),
          cpu_p99: percentile(s.cpu, 0.99),
          mem_avg_mb: memAvg,
          mem_p95_mb: percentile(s.memMb, 0.95),
          mem_p99_mb: percentile(s.memMb, 0.99),
          mem_growth_mb_s: slope,
        };
      });

      // Sort by CPU avg desc, then Mem avg desc.
      rows.sort(
        (a, b) =>
          (b.cpu_avg ?? 0) - (a.cpu_avg ?? 0) ||
          (b.mem_avg_mb ?? 0) - (a.mem_avg_mb ?? 0)
      );
      out[r.id] = rows;
    }
    return out;
  }, [reports, cpuSelById, memSelById]);

  const compareStatsById = useMemo(() => {
    const out: Record<
      number,
      {
        cpu_avg?: number;
        cpu_p95?: number;
        cpu_p99?: number;
        mem_avg_mb?: number;
        mem_p95_mb?: number;
        mem_p99_mb?: number;
        mem_growth_mb_s?: number;
        samples_total: number;
        samples_cpu: number;
        samples_mem: number;
      }
    > = {};
    for (const r of reports) {
      const cpuVals = finite(alignedData.map((d) => d[`cpu_${r.id}`]));
      const memBytes = finite(alignedData.map((d) => d[`mem_${r.id}`]));
      const memMb = memBytes.map((b) => b / 1024 / 1024);
      const t = alignedData.map((d) => d.time_s as number);
      const memT: number[] = [];
      const memY: number[] = [];
      alignedData.forEach((d, idx) => {
        const v = d[`mem_${r.id}`];
        if (typeof v === "number" && Number.isFinite(v)) {
          memT.push(t[idx]);
          memY.push(v / 1024 / 1024);
        }
      });
      const slope = linregSlope(memT, memY);
      out[r.id] = {
        cpu_avg: avg(cpuVals),
        cpu_p95: percentile(cpuVals, 0.95),
        cpu_p99: percentile(cpuVals, 0.99),
        mem_avg_mb: avg(memMb),
        mem_p95_mb: percentile(memMb, 0.95),
        mem_p99_mb: percentile(memMb, 0.99),
        mem_growth_mb_s: slope != null ? slope : undefined,
        samples_total: alignedData.length,
        samples_cpu: cpuVals.length,
        samples_mem: memMb.length,
      };
    }
    return out;
  }, [reports, alignedData]);

  const driverDeltas = useMemo(() => {
    if (baselineId == null) return null;
    const baseline = reports.find((r) => r.id === baselineId);
    if (!baseline) return null;

    const readSeriesPerPid = (
      r: ReportDetailData,
      selectedArr: number[] | undefined,
      pick: (m: any) => number | undefined
    ) => {
      const selected = new Set(selectedArr ?? []);
      const byPid = new Map<number, number[]>();
      if (!selected.size) return byPid;
      (r.metrics ?? []).forEach((b: any) => {
        const mm = b?.metrics ?? {};
        Object.entries(mm).forEach(([pidStr, m]: any) => {
          const pid = Number(pidStr);
          if (!Number.isFinite(pid)) return;
          if (!selected.has(pid)) return;
          const v = pick(m);
          if (typeof v !== "number" || !Number.isFinite(v)) return;
          if (!byPid.has(pid)) byPid.set(pid, []);
          byPid.get(pid)!.push(v);
        });
      });
      return byPid;
    };

    const avgMap = (m: Map<number, number[]>, scale?: (v: number) => number) => {
      const out = new Map<number, number>();
      m.forEach((arr, pid) => {
        const a = avg(arr);
        if (a == null) return;
        out.set(pid, scale ? scale(a) : a);
      });
      return out;
    };

    const baseCpuByPid = avgMap(
      readSeriesPerPid(baseline, cpuSelById[baseline.id], (m) => m?.cpu_usage)
    );
    const baseMemByPid = avgMap(
      readSeriesPerPid(
        baseline,
        memSelById[baseline.id],
        (m) => m?.memory_private ?? m?.memory_footprint ?? m?.memory_rss
      ),
      (b) => b / 1024 / 1024
    );

    const labelFor = (r: ReportDetailData, pid: number) => {
      const snap: any[] = Array.isArray(r.meta?.process_snapshot)
        ? r.meta.process_snapshot
        : [];
      const s = snap.find((p) => Number(p?.pid) === pid);
      const base = String(s?.alias ?? s?.title ?? s?.name ?? `PID ${pid}`);
      return `${base} (${pid})`;
    };

    const targets = reports.filter((r) => r.id !== baseline.id);
    return targets.map((r) => {
      const cpuByPid = avgMap(
        readSeriesPerPid(r, cpuSelById[r.id], (m) => m?.cpu_usage)
      );
      const memByPid = avgMap(
        readSeriesPerPid(
          r,
          memSelById[r.id],
          (m) => m?.memory_private ?? m?.memory_footprint ?? m?.memory_rss
        ),
        (b) => b / 1024 / 1024
      );

      const cpuDeltas: Array<{ pid: number; label: string; delta: number }> = [];
      const memDeltas: Array<{ pid: number; label: string; delta: number }> = [];

      const allCpuPids = new Set<number>([
        ...Array.from(baseCpuByPid.keys()),
        ...Array.from(cpuByPid.keys()),
      ]);
      allCpuPids.forEach((pid) => {
        const d = (cpuByPid.get(pid) ?? 0) - (baseCpuByPid.get(pid) ?? 0);
        if (d !== 0) cpuDeltas.push({ pid, label: labelFor(r, pid), delta: d });
      });

      const allMemPids = new Set<number>([
        ...Array.from(baseMemByPid.keys()),
        ...Array.from(memByPid.keys()),
      ]);
      allMemPids.forEach((pid) => {
        const d = (memByPid.get(pid) ?? 0) - (baseMemByPid.get(pid) ?? 0);
        if (d !== 0) memDeltas.push({ pid, label: labelFor(r, pid), delta: d });
      });

      cpuDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
      memDeltas.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

      return {
        id: r.id,
        title: r.title,
        topCpu: cpuDeltas.slice(0, 6),
        topMem: memDeltas.slice(0, 6),
      };
    });
  }, [reports, baselineId, cpuSelById, memSelById]);

  const reportById = useMemo(() => {
    const m = new Map<number, ReportDetailData>();
    reports.forEach((r) => m.set(r.id, r));
    return m;
  }, [reports]);

  const colorById = useMemo(() => {
    const ids = reports.map((r) => r.id);
    const m: Record<number, string> = {};
    let paletteIdx = 0;
    for (const id of ids) {
      if (baselineId != null && id === baselineId) {
        m[id] = COLORS.BASELINE;
        continue;
      }
      m[id] = COLORS.PALETTE[paletteIdx % COLORS.PALETTE.length];
      paletteIdx++;
    }
    return m;
  }, [reports, baselineId]);

  const togglePidInArr = (arr: number[], pid: number) => {
    const set = new Set(arr);
    if (set.has(pid)) set.delete(pid);
    else set.add(pid);
    return Array.from(set.values());
  };

  const renderProcSelector = (
    r: ReportDetailData,
    metric: MetricTab,
    accent: string
  ) => {
    const items = extractProcItems(r);
    const allPids = items.map((p) => p.pid);
    const selectedArr = metric === "cpu" ? cpuSelById[r.id] ?? [] : memSelById[r.id] ?? [];
    const selectedSet = new Set(selectedArr);
    const selectedCount = allPids.filter((pid) => selectedSet.has(pid)).length;

    const setSelected = (nextArr: number[]) => {
      if (metric === "cpu") {
        setCpuSelById((prev) => ({ ...prev, [r.id]: nextArr }));
      } else {
        setMemSelById((prev) => ({ ...prev, [r.id]: nextArr }));
      }
    };

    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-sm font-medium min-w-0">
            <span
              className="inline-block w-2 h-2 rounded-full mr-2"
              style={{ backgroundColor: accent }}
            />
            <span className="truncate">{r.title}</span>
            <span className="ml-2 text-xs text-slate-500">
              ({selectedCount}/{items.length})
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setSelected(allPids)}
              className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => setSelected([])}
              className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
            >
              None
            </button>
          </div>
        </div>
        <div className="max-h-[220px] overflow-y-auto custom-scrollbar space-y-1">
          {items.map((p) => {
            const checked = selectedSet.has(p.pid);
            return (
              <button
                key={`${metric}_${r.id}_${p.pid}`}
                type="button"
                onClick={() => setSelected(togglePidInArr(selectedArr, p.pid))}
                className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-sm transition-colors ${
                  checked
                    ? "border-indigo-500/30 bg-indigo-600/5 dark:bg-indigo-900/20"
                    : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/60"
                }`}
                title={p.proc_type ? `${p.proc_type} · PID ${p.pid}` : `PID ${p.pid}`}
              >
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate font-medium">{p.label}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {p.proc_type ? `${p.proc_type} · ` : ""}PID {p.pid}
                  </div>
                </div>
                <div
                  className={`w-4 h-4 rounded border flex items-center justify-center ${
                    checked
                      ? "bg-indigo-600 border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500"
                      : "border-slate-300 dark:border-slate-600"
                  }`}
                >
                  {checked ? (
                    <div className="w-2 h-2 bg-white rounded-sm" />
                  ) : null}
                </div>
              </button>
            );
          })}
          {items.length === 0 && (
            <div className="text-sm text-slate-500 py-6 text-center">
              No processes found.
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading)
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader className="animate-spin w-6 h-6 mr-2" /> Comparing...
      </div>
    );
  if (error || reports.length < 2)
    return (
      <div className="p-8 text-rose-400 flex items-center gap-2">
        <AlertTriangle className="w-5 h-5" /> {error}
      </div>
    );

  const baseline = baselineId != null ? reportById.get(baselineId) : null;
  const targets = reports.filter((r) => baselineId == null || r.id !== baselineId);

  const warnings: string[] = [];
  if (baseline) {
    const baseMode = baseline.meta?.collection?.mode;
    const baseInterval = baseline.meta?.collection?.interval_ms;
    for (const r of targets) {
      const m = r.meta?.collection?.mode;
      const it = r.meta?.collection?.interval_ms;
      if (baseMode && m && baseMode !== m) {
        warnings.push(
          `Mode mismatch: baseline is "${baseMode}" but report #${r.id} is "${m}". Results may not be directly comparable.`
        );
      }
      if (
        typeof baseInterval === "number" &&
        typeof it === "number" &&
        baseInterval !== it
      ) {
        warnings.push(
          `Interval mismatch: baseline is ${baseInterval}ms but report #${r.id} is ${it}ms.`
        );
      }
    }
  }

  return (
    <div className="p-8 h-full overflow-y-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      <div className="flex items-center gap-4 mb-6">
        <Link
          to="/reports"
          className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 dark:hover:bg-slate-900 dark:text-slate-400"
        >
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center justify-between gap-4 w-full">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GitCompare className="w-5 h-5" /> Comparison
          </h1>
          <button
            type="button"
            disabled={isExporting}
            onClick={async () => {
              try {
                setIsExporting(true);
                const pdf = new jsPDF("p", "mm", "a4");
                const W = pdf.internal.pageSize.getWidth();
                const H = pdf.internal.pageSize.getHeight();
                const marginX = 14;
                const topY = 14;
                let y = topY;
                pdf.setTextColor(17, 24, 39);

                const addSectionTitle = (t: string) => {
                  y += 2;
                  pdf.setFont("helvetica", "bold");
                  pdf.setFontSize(13);
                  pdf.text(t, marginX, y);
                  y += 2;
                  pdf.setDrawColor(203, 213, 225);
                  pdf.line(marginX, y, W - marginX, y);
                  y += 6;
                };

                const addKV = (k: string, v: string) => {
                  const keyW = 52;
                  pdf.setFont("helvetica", "normal");
                  pdf.setFontSize(10);
                  pdf.setTextColor(71, 85, 105);
                  pdf.text(`${k}:`, marginX, y);
                  pdf.setTextColor(17, 24, 39);
                  const lines = pdf.splitTextToSize(v || "—", W - marginX * 2 - keyW);
                  pdf.text(lines, marginX + keyW, y);
                  y += Math.max(5, lines.length * 5);
                  if (y > H - 18) {
                    pdf.addPage();
                    y = topY;
                  }
                };

                const fmtMaybe = (v: any) => (v == null || v === "" ? "—" : String(v));
                const ids = reports.map((r) => r.id);
                const created = new Date().toLocaleString();

                pdf.setFont("helvetica", "bold");
                pdf.setFontSize(18);
                pdf.text("PerfSight Comparison Report", marginX, y);
                y += 8;
                pdf.setFont("helvetica", "normal");
                pdf.setFontSize(11);
                pdf.setTextColor(71, 85, 105);
                pdf.text(`Generated: ${created}`, marginX, y);
                y += 7;

                addSectionTitle("Scope");
                addKV("Reports", ids.map((id) => `#${id}`).join(", "));
                addKV("Baseline", baseline ? `#${baseline.id} — ${baseline.title}` : "None (overlay)");
                const fmtPidList = (r: ReportDetailData, pids: number[]) => {
                  const labels = (pids ?? []).map((pid) => pidLabel(r, pid));
                  const shown = labels.slice(0, 12);
                  const extra = labels.length - shown.length;
                  return shown.join(", ") + (extra > 0 ? ` (+${extra} more)` : "");
                };

                addSectionTitle("Selected Processes (explicit)");
                for (const r of reports) {
                  const cpuPids = cpuSelById[r.id] ?? [];
                  const memPids = memSelById[r.id] ?? [];
                  addKV(
                    `#${r.id} CPU`,
                    cpuPids.length ? fmtPidList(r, cpuPids) : "—"
                  );
                  addKV(
                    `#${r.id} Mem`,
                    memPids.length ? fmtPidList(r, memPids) : "—"
                  );
                }

                addSectionTitle("Key Metrics (selected processes)");
                const header = ["Report", "CPU avg", "CPU p95", "Mem avg", "Mem p95", "Mem growth"];
                const rows = reports.map((r) => {
                  const s = compareStatsById[r.id];
                  const growth = s?.mem_growth_mb_s;
                  return [
                    `#${r.id}${baselineId === r.id ? " (Baseline)" : ""}`,
                    fmtMaybe(s?.cpu_avg != null ? s.cpu_avg.toFixed(1) + "%" : "—"),
                    fmtMaybe(s?.cpu_p95 != null ? s.cpu_p95.toFixed(1) + "%" : "—"),
                    fmtMaybe(s?.mem_avg_mb != null ? s.mem_avg_mb.toFixed(0) + " MB" : "—"),
                    fmtMaybe(s?.mem_p95_mb != null ? s.mem_p95_mb.toFixed(0) + " MB" : "—"),
                    fmtMaybe(growth != null ? `${growth.toFixed(2)} MB/s` : "—"),
                  ];
                });

                const colW = [46, 24, 24, 24, 24, 30];
                const rowH = 6;
                const drawRow = (cells: string[], bold = false) => {
                  pdf.setFont("helvetica", bold ? "bold" : "normal");
                  pdf.setFontSize(9.5);
                  pdf.setTextColor(bold ? 17 : 17, bold ? 24 : 24, bold ? 39 : 39);
                  let x = marginX;
                  cells.forEach((c, i) => {
                    const text = pdf.splitTextToSize(String(c), colW[i] - 2);
                    pdf.text(text, x, y);
                    x += colW[i];
                  });
                  y += rowH;
                  if (y > H - 18) {
                    pdf.addPage();
                    y = topY;
                  }
                };
                drawRow(header, true);
                rows.forEach((r) => drawRow(r, false));

                if (baseline) {
                  addSectionTitle("Delta vs Baseline");
                  targets.forEach((r) => {
                    const a = compareStatsById[baseline.id];
                    const b = compareStatsById[r.id];
                    addKV(
                      `#${r.id}`,
                      `CPU avg ${a?.cpu_avg != null && b?.cpu_avg != null ? (b.cpu_avg - a.cpu_avg).toFixed(1) + "%" : "—"}, ` +
                        `CPU p95 ${a?.cpu_p95 != null && b?.cpu_p95 != null ? (b.cpu_p95 - a.cpu_p95).toFixed(1) + "%" : "—"}, ` +
                        `Mem avg ${a?.mem_avg_mb != null && b?.mem_avg_mb != null ? (b.mem_avg_mb - a.mem_avg_mb).toFixed(0) + " MB" : "—"}, ` +
                        `Mem growth ${a?.mem_growth_mb_s != null && b?.mem_growth_mb_s != null ? (b.mem_growth_mb_s - a.mem_growth_mb_s).toFixed(2) + " MB/s" : "—"}`
                    );
                  });
                }

                if (warnings.length) {
                  addSectionTitle("Data Quality Notes");
                  warnings.slice(0, 10).forEach((w, i) => addKV(`Note ${i + 1}`, w));
                }

                addSectionTitle("Per-Report Details");
                for (const r of reports) {
                  const tc = r.meta?.test_context ?? r.meta?.collection?.test_context ?? {};
                  const env = r.meta?.env ?? {};
                  addKV(
                    `Report #${r.id}`,
                    `${r.title} · ${new Date(r.created_at).toLocaleString()}`
                  );
                  addKV("Mode", fmtMaybe(r.meta?.collection?.mode));
                  addKV(
                    "Interval",
                    r.meta?.collection?.interval_ms != null
                      ? `${r.meta.collection.interval_ms}ms`
                      : "—"
                  );
                  addKV(
                    "Duration",
                    r.meta?.collection?.duration_seconds != null
                      ? `${r.meta.collection.duration_seconds}s`
                      : "—"
                  );
                  addKV("Scenario", fmtMaybe(tc?.scenario_name));
                  addKV("Build ID", fmtMaybe(tc?.build_id));
                  addKV("Tags", Array.isArray(tc?.tags) ? tc.tags.join(", ") : "—");
                  addKV("Device", fmtMaybe(env?.device_name));
                  addKV("OS", fmtMaybe(env?.os));
                  addKV("CPU", fmtMaybe(env?.cpu_brand));
                  addKV(
                    "RAM",
                    env?.total_memory_bytes != null
                      ? `${Math.round(env.total_memory_bytes / 1024 / 1024 / 1024)} GB`
                      : "—"
                  );

                  const perPid = perPidSummariesById[r.id] ?? [];
                  if (perPid.length) {
                    addSectionTitle(`Per-Process Metrics (selected) — #${r.id}`);
                    const ph = ["Process", "CPU avg", "CPU p95", "Mem avg", "Mem p95", "Growth"];
                    const pcw = [62, 22, 22, 22, 22, 26];
                    const prowH = 6;
                    const drawPRow = (cells: string[], bold = false) => {
                      pdf.setFont("helvetica", bold ? "bold" : "normal");
                      pdf.setFontSize(9.0);
                      pdf.setTextColor(17, 24, 39);
                      let x = marginX;
                      cells.forEach((c, i) => {
                        const text = pdf.splitTextToSize(String(c), pcw[i] - 2);
                        pdf.text(text, x, y);
                        x += pcw[i];
                      });
                      y += prowH;
                      if (y > H - 18) {
                        pdf.addPage();
                        y = topY;
                      }
                    };
                    drawPRow(ph, true);
                    perPid.slice(0, 12).forEach((p) => {
                      drawPRow([
                        p.label,
                        p.cpu_avg != null ? `${p.cpu_avg.toFixed(1)}%` : "—",
                        p.cpu_p95 != null ? `${p.cpu_p95.toFixed(1)}%` : "—",
                        p.mem_avg_mb != null ? `${p.mem_avg_mb.toFixed(0)}MB` : "—",
                        p.mem_p95_mb != null ? `${p.mem_p95_mb.toFixed(0)}MB` : "—",
                        p.mem_growth_mb_s != null ? `${p.mem_growth_mb_s.toFixed(2)}` : "—",
                      ]);
                    });
                  }
                }

                // Appendix: charts as images.
                const cpuEl = document.getElementById("compare-cpu-chart");
                const memEl = document.getElementById("compare-mem-chart");
                const addChartImage = async (el: HTMLElement, title: string) => {
                  pdf.addPage();
                  let y2 = topY;
                  pdf.setFont("helvetica", "bold");
                  pdf.setFontSize(14);
                  pdf.setTextColor(17, 24, 39);
                  pdf.text(title, marginX, y2);
                  y2 += 6;
                  const canvas = await html2canvas(el, { backgroundColor: "#ffffff", scale: 2 });
                  const img = canvas.toDataURL("image/png");
                  const imgW = W - marginX * 2;
                  const imgH = (canvas.height / canvas.width) * imgW;
                  pdf.addImage(img, "PNG", marginX, y2, imgW, Math.min(imgH, H - y2 - 10));
                };
                if (cpuEl) await addChartImage(cpuEl, "Appendix A — CPU Comparison");
                if (memEl) await addChartImage(memEl, "Appendix B — Memory Comparison");

                const dataUri = pdf.output("datauristring");
                const filename = `PerfSight_Comparison_${ids.join("_")}.pdf`;
                try {
                  const saved = (await invoke("export_report_pdf", {
                    reportId: baseline?.id ?? reports[0].id,
                    filename,
                    pdfBase64: dataUri,
                  })) as string;
                  alert(`PDF saved:\n${saved}`);
                } catch (e) {
                  console.error("export_report_pdf failed", e);
                  pdf.save(filename);
                }
              } catch (e) {
                console.error("Compare export failed", e);
                alert("Failed to export compare PDF");
              } finally {
                setIsExporting(false);
              }
            }}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            title="Export Comparison PDF"
          >
            <Download className="w-4 h-4" /> {isExporting ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </div>

      {/* Baseline selector */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="text-sm font-medium">Reports (max {maxCompare})</div>
            <div className="text-xs text-slate-500">
              Choose a baseline to enable delta tables, or select “None” for pure overlay.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-500">Baseline</div>
            <select
              value={baselineId ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setBaselineId(v ? Number(v) : null);
              }}
              className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
            >
              <option value="">None (overlay)</option>
              {reports.map((r) => (
                <option key={`base_${r.id}`} value={String(r.id)}>
                  #{r.id} — {r.title}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-1 lg:grid-cols-3 gap-3">
          {reports.map((r) => (
            <div
              key={`ctx_${r.id}`}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40"
              style={{ borderLeftWidth: 4, borderLeftColor: colorById[r.id] }}
            >
              <div className="text-xs text-slate-500 uppercase font-bold mb-1">
                #{r.id} {baselineId === r.id ? "Baseline" : "Target"}
              </div>
              <div className="font-medium truncate">{r.title}</div>
              <div className="text-sm text-slate-500">
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div className="text-xs text-slate-500 mt-2">
                mode: {r.meta?.collection?.mode ?? "—"} · interval:{" "}
                {r.meta?.collection?.interval_ms ?? "—"}ms · duration:{" "}
                {r.meta?.collection?.duration_seconds ?? "—"}s
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Delta table (only when baseline selected) */}
      {baseline && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-slate-700 dark:text-slate-400 font-medium mb-3">
            Delta vs Baseline (selected processes)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                  <th className="text-left py-2 pr-3">Report</th>
                  <th className="text-right py-2 px-3">CPU avg</th>
                  <th className="text-right py-2 px-3">CPU p95</th>
                  <th className="text-right py-2 px-3">Mem avg</th>
                  <th className="text-right py-2 pl-3">Mem growth</th>
                </tr>
              </thead>
              <tbody className="text-slate-900 dark:text-slate-200">
                {targets.map((r) => {
                  const a = compareStatsById[baseline.id];
                  const b = compareStatsById[r.id];
                  const cpuAvgDelta =
                    typeof a?.cpu_avg === "number" && typeof b?.cpu_avg === "number"
                      ? b.cpu_avg - a.cpu_avg
                      : null;
                  const cpuP95Delta =
                    typeof a?.cpu_p95 === "number" && typeof b?.cpu_p95 === "number"
                      ? b.cpu_p95 - a.cpu_p95
                      : null;
                  const memAvgDelta =
                    typeof a?.mem_avg_mb === "number" && typeof b?.mem_avg_mb === "number"
                      ? b.mem_avg_mb - a.mem_avg_mb
                      : null;
                  const memGrowthDelta =
                    typeof a?.mem_growth_mb_s === "number" && typeof b?.mem_growth_mb_s === "number"
                      ? b.mem_growth_mb_s - a.mem_growth_mb_s
                      : null;

                  return (
                    <tr
                      key={`delta_${r.id}`}
                      className="border-b border-slate-200 dark:border-slate-800/50"
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: colorById[r.id] }}
                          />
                          <div className="truncate">
                            #{r.id} — {r.title}
                          </div>
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {cpuAvgDelta == null ? "—" : deltaBadge(cpuAvgDelta, true)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {cpuP95Delta == null ? "—" : deltaBadge(cpuP95Delta, true)}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums">
                        {memAvgDelta == null ? "—" : deltaBadge(memAvgDelta, true)}
                      </td>
                      <td className="py-2 pl-3 text-right tabular-nums">
                        {memGrowthDelta == null
                          ? "—"
                          : `${memGrowthDelta > 0 ? "+" : ""}${memGrowthDelta.toFixed(2)} MB/s`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Baseline: #{baseline.id} — {baseline.title} · CPU avg {fmtPct(compareStatsById[baseline.id]?.cpu_avg)} · Mem avg{" "}
            {fmtMb(compareStatsById[baseline.id]?.mem_avg_mb)}
          </div>
        </div>
      )}

      {/* Professional analysis sections */}
      <div className="mb-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-medium mb-2">Executive Summary</div>
          <div className="text-xs text-slate-500 mb-3">
            Computed from the currently selected processes (CPU/Memory selectors).
          </div>
          {baseline ? (
            <div className="space-y-2 text-sm">
              {targets.map((r) => {
                const a = compareStatsById[baseline.id];
                const b = compareStatsById[r.id];
                const cpu = a?.cpu_p95 != null && b?.cpu_p95 != null ? b.cpu_p95 - a.cpu_p95 : null;
                const mem = a?.mem_avg_mb != null && b?.mem_avg_mb != null ? b.mem_avg_mb - a.mem_avg_mb : null;
                return (
                  <div key={`exec_${r.id}`} className="flex items-center justify-between gap-3">
                    <div className="truncate">
                      <span className="font-medium">#{r.id}</span> <span className="text-slate-500">vs baseline</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {cpu == null ? <span className="text-xs text-slate-500">CPU —</span> : deltaBadge(cpu, true)}
                      {mem == null ? <span className="text-xs text-slate-500">Mem —</span> : deltaBadge(mem, true)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Select a baseline to generate deltas.</div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-medium mb-2">Data Quality</div>
          <div className="text-xs text-slate-500 mb-3">
            Sampling coverage for the selected processes.
          </div>
          <div className="space-y-2 text-sm">
            {reports.map((r) => {
              const s = compareStatsById[r.id];
              const cpuCov =
                s.samples_total > 0 ? (s.samples_cpu / s.samples_total) * 100 : 0;
              const memCov =
                s.samples_total > 0 ? (s.samples_mem / s.samples_total) * 100 : 0;
              return (
                <div key={`dq_${r.id}`} className="flex items-center justify-between gap-3">
                  <div className="truncate">
                    <span className="font-medium">#{r.id}</span>{" "}
                    <span className="text-slate-500">{r.title}</span>
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums shrink-0">
                    CPU {cpuCov.toFixed(0)}% · Mem {memCov.toFixed(0)}%
                  </div>
                </div>
              );
            })}
          </div>
          {warnings.length ? (
            <div className="mt-3 text-xs text-amber-600 dark:text-amber-300">
              {warnings[0]}
            </div>
          ) : null}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <div className="text-sm font-medium mb-2">Top Drivers (vs baseline)</div>
          <div className="text-xs text-slate-500 mb-3">
            Largest per-PID avg deltas for the selected processes.
          </div>
          {!driverDeltas ? (
            <div className="text-sm text-slate-500">Select a baseline to see drivers.</div>
          ) : (
            <div className="space-y-3">
              {driverDeltas.map((d) => (
                <div key={`drv_${d.id}`}>
                  <div className="text-xs text-slate-500 mb-1">
                    #{d.id} — {d.title}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300">
                    CPU:{" "}
                    {d.topCpu.length
                      ? d.topCpu
                          .slice(0, 2)
                          .map((x) => `${x.label} (${x.delta > 0 ? "+" : ""}${x.delta.toFixed(1)}%)`)
                          .join(", ")
                      : "—"}
                  </div>
                  <div className="text-xs text-slate-700 dark:text-slate-300">
                    Mem:{" "}
                    {d.topMem.length
                      ? d.topMem
                          .slice(0, 2)
                          .map((x) => `${x.label} (${x.delta > 0 ? "+" : ""}${x.delta.toFixed(0)}MB)`)
                          .join(", ")
                      : "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Details-aligned sections */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm font-medium mb-1">Comparison Report (Details-aligned)</div>
        <div className="text-xs text-slate-500">
          This section mirrors the structure of Report Details and is computed from the current PID selections.
        </div>
      </div>

      <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        {reports.map((r) => {
          const tc = r.meta?.test_context ?? r.meta?.collection?.test_context ?? {};
          const env = r.meta?.env ?? {};
          const selCpu = cpuSelById[r.id] ?? [];
          const selMem = memSelById[r.id] ?? [];
          const perPid = perPidSummariesById[r.id] ?? [];
          const insights: string[] = Array.isArray(r.analysis?.insights) ? r.analysis!.insights : [];
          return (
            <div
              key={`detail_${r.id}`}
              className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
              style={{ borderLeftWidth: 4, borderLeftColor: colorById[r.id] }}
            >
              <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="text-xs text-slate-500 uppercase font-bold">
                    #{r.id} {baselineId === r.id ? "Baseline" : "Report"}
                  </div>
                  <div className="font-medium truncate">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {new Date(r.created_at).toLocaleString()}
                  </div>
                </div>
                <Link
                  to={`/report/${r.id}`}
                  className="text-xs px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200 shrink-0"
                >
                  Open Details
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-xs text-slate-500 mb-2">Run Context</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">mode</span>
                      <span className="tabular-nums">{r.meta?.collection?.mode ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">interval</span>
                      <span className="tabular-nums">
                        {r.meta?.collection?.interval_ms != null ? `${r.meta.collection.interval_ms}ms` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">duration</span>
                      <span className="tabular-nums">
                        {r.meta?.collection?.duration_seconds != null ? `${r.meta.collection.duration_seconds}s` : "—"}
                      </span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">build</span>
                      <span className="tabular-nums truncate">{tc?.build_id ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">scenario</span>
                      <span className="tabular-nums truncate">{tc?.scenario_name ?? "—"}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      tags: {Array.isArray(tc?.tags) ? tc.tags.join(", ") : "—"}
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="text-xs text-slate-500 mb-2">Environment</div>
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">device</span>
                      <span className="tabular-nums truncate">{env?.device_name ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">os</span>
                      <span className="tabular-nums truncate">{env?.os ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">arch</span>
                      <span className="tabular-nums">{env?.arch ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">cpu</span>
                      <span className="tabular-nums truncate">{env?.cpu_brand ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-400">ram</span>
                      <span className="tabular-nums">
                        {env?.total_memory_bytes != null ? `${Math.round(env.total_memory_bytes / 1024 / 1024 / 1024)} GB` : "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                  <div className="text-xs text-slate-500 mb-2">Selected Processes</div>
                  <div className="text-xs text-slate-600 dark:text-slate-300">
                    CPU: {selCpu.length ? selCpu.map((pid) => pidLabel(r, pid)).slice(0, 4).join(", ") : "—"}
                    {selCpu.length > 4 ? ` (+${selCpu.length - 4})` : ""}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Mem: {selMem.length ? selMem.map((pid) => pidLabel(r, pid)).slice(0, 4).join(", ") : "—"}
                    {selMem.length > 4 ? ` (+${selMem.length - 4})` : ""}
                  </div>
                </div>
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                  <div className="text-xs text-slate-500 mb-2">Insights</div>
                  {insights.length ? (
                    <ul className="text-xs text-slate-700 dark:text-slate-300 space-y-1">
                      {insights.slice(0, 3).map((t, i) => (
                        <li key={`ins_${r.id}_${i}`} className="truncate" title={t}>
                          • {t}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-slate-500">—</div>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <div className="text-xs text-slate-500 mb-2">Per-Process Metrics (selected)</div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                        <th className="text-left py-2 pr-3">Process</th>
                        <th className="text-right py-2 px-3">CPU avg</th>
                        <th className="text-right py-2 px-3">CPU p95</th>
                        <th className="text-right py-2 px-3">Mem avg</th>
                        <th className="text-right py-2 pl-3">Mem growth</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-900 dark:text-slate-200">
                      {perPid.slice(0, 10).map((p) => (
                        <tr key={`pp_${r.id}_${p.pid}`} className="border-b border-slate-200 dark:border-slate-800/50">
                          <td className="py-2 pr-3">
                            <div className="truncate max-w-[360px]" title={p.label}>
                              {p.label}
                            </div>
                            <div className="text-xs text-slate-500">
                              {p.proc_type ?? "—"} · {p.cpu_selected ? "CPU" : "—"} / {p.mem_selected ? "Mem" : "—"}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {p.cpu_avg != null ? `${p.cpu_avg.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {p.cpu_p95 != null ? `${p.cpu_p95.toFixed(1)}%` : "—"}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums">
                            {p.mem_avg_mb != null ? `${p.mem_avg_mb.toFixed(0)} MB` : "—"}
                          </td>
                          <td className="py-2 pl-3 text-right tabular-nums">
                            {p.mem_growth_mb_s != null ? `${p.mem_growth_mb_s.toFixed(2)} MB/s` : "—"}
                          </td>
                        </tr>
                      ))}
                      {perPid.length === 0 && (
                        <tr>
                          <td colSpan={5} className="py-4 text-center text-slate-500">
                            No selected processes.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {perPid.length > 10 && (
                    <div className="mt-2 text-xs text-slate-500">
                      Showing top 10 rows (sorted by CPU avg).
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Process selectors */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
          <div>
            <div className="text-sm font-medium">Process selection (drives charts)</div>
            <div className="text-xs text-slate-500">
              Select independently per report. If a report has no selected processes, its line will be hidden.
            </div>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            {(["cpu", "mem"] as MetricTab[]).map((k) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  tab === k
                    ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {k === "cpu" ? "CPU" : "Memory"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {reports.map((r) => renderProcSelector(r, tab, colorById[r.id]))}
        </div>
      </div>

      {/* Charts */}
      <div className="space-y-6">
        {/* CPU Compare */}
        <div
          id="compare-cpu-chart"
          className="bg-white border border-slate-200 rounded-xl p-5 h-[380px] shadow-xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        >
          <h3 className="text-slate-700 dark:text-slate-400 font-medium mb-4">
            Selected CPU Comparison
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alignedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis
                  dataKey="time_s"
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={10}
                  tickFormatter={(v: any) =>
                    typeof v === "number" ? String(Math.round(v)) : ""
                  }
                />
                <YAxis
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={12}
                  label={{ value: "%", position: "insideLeft", angle: -90 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) =>
                    `T+${typeof label === "number" ? Math.round(label) : label}s`
                  }
                  formatter={(val: any) => (typeof val === "number" ? [val.toFixed(1) + "%"] : ["—"])}
                />
                <Legend
                  wrapperStyle={{
                    cursor: "pointer",
                    color: isDark ? "#cbd5e1" : "#334155",
                  }}
                />
                {reports.map((r) => (
                  <Line
                    key={`cpu_line_${r.id}`}
                    name={`${baselineId === r.id ? "Baseline" : "Report"} #${r.id}: ${r.title}`}
                    type="monotone"
                    dataKey={`cpu_${r.id}`}
                    stroke={colorById[r.id]}
                    strokeWidth={baselineId === r.id ? 3 : 2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Brush
                  dataKey="time_s"
                  height={30}
                  stroke={axisStroke}
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex justify-end">Seconds (T+)</div>
        </div>

        {/* Memory Compare */}
        <div
          id="compare-mem-chart"
          className="bg-white border border-slate-200 rounded-xl p-5 h-[380px] shadow-xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        >
          <h3 className="text-slate-700 dark:text-slate-400 font-medium mb-4">
            Selected Memory Comparison
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alignedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis
                  dataKey="time_s"
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={10}
                  tickFormatter={(v: any) =>
                    typeof v === "number" ? String(Math.round(v)) : ""
                  }
                />
                <YAxis
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={12}
                  tickFormatter={(val: any) =>
                    typeof val === "number" ? (val / 1024 / 1024).toFixed(0) : ""
                  }
                  label={{ value: "MB", position: "insideLeft", angle: -90 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) =>
                    `T+${typeof label === "number" ? Math.round(label) : label}s`
                  }
                  formatter={(val: any) =>
                    typeof val === "number"
                      ? [(val / 1024 / 1024).toFixed(1) + " MB"]
                      : ["—"]
                  }
                />
                <Legend
                  wrapperStyle={{
                    cursor: "pointer",
                    color: isDark ? "#cbd5e1" : "#334155",
                  }}
                />
                {reports.map((r) => (
                  <Line
                    key={`mem_line_${r.id}`}
                    name={`${baselineId === r.id ? "Baseline" : "Report"} #${r.id}: ${r.title}`}
                    type="monotone"
                    dataKey={`mem_${r.id}`}
                    stroke={colorById[r.id]}
                    strokeWidth={baselineId === r.id ? 3 : 2}
                    dot={false}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                ))}
                <Brush
                  dataKey="time_s"
                  height={30}
                  stroke={axisStroke}
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 text-xs text-slate-500 flex justify-end">Seconds (T+)</div>
        </div>
      </div>
    </div>
  );
};

