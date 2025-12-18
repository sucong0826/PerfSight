import React, { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Brush,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { LayoutGrid, Rows, Cpu, Database, Activity } from "lucide-react";
import { useTheme } from "../theme";

export interface ProcessInfo {
  pid: number;
  alias?: string | null;
  name: string;
  memory_usage: number;
  cpu_usage: number;
  proc_type: string;
  title?: string;
  url?: string;
}

interface ChartsProps {
  data: any[];
  selectedProcesses: ProcessInfo[];
  hiddenPids: Set<number>;
  onToggleVisibility: (pid: number) => void;
  mode: "system" | "browser";
  metricStandard: "os" | "chrome";
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

const getColor = (index: number) => {
  const colors = [
    "#6366f1",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
    "#d946ef",
  ];
  return colors[index % colors.length];
};

const displayProcessLabel = (p: ProcessInfo) => {
  const alias = (p.alias || "").trim();
  const base = alias ? alias : (p.title || p.name);
  return `${base} (${p.pid})`;
};

const median = (arr: number[]) => {
  if (arr.length === 0) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
};

const madOutlierIndexes = (
  values: Array<number | undefined | null>,
  z = 3.5
) => {
  // Robust outlier detection using Median Absolute Deviation (MAD).
  // Returns a set of sample indexes considered anomalous.
  const finite: number[] = [];
  values.forEach((v) => {
    if (typeof v === "number" && Number.isFinite(v)) finite.push(v);
  });
  if (finite.length < 8) return new Set<number>();
  const m = median(finite);
  const absDevs = finite.map((v) => Math.abs(v - m));
  const mad = median(absDevs);
  if (!Number.isFinite(mad) || mad === 0) return new Set<number>();
  const denom = 1.4826 * mad;
  const out = new Set<number>();
  values.forEach((v, idx) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    const rz = Math.abs((v - m) / denom);
    if (rz >= z) out.add(idx);
  });
  return out;
};

const madOutlierIndexesUpper = (
  values: Array<number | undefined | null>,
  z = 3.5
) => {
  // Same as MAD outlier detection, but only flags unusually HIGH values (spikes).
  const finite: number[] = [];
  values.forEach((v) => {
    if (typeof v === "number" && Number.isFinite(v)) finite.push(v);
  });
  if (finite.length < 8) return new Set<number>();
  const m = median(finite);
  const absDevs = finite.map((v) => Math.abs(v - m));
  const mad = median(absDevs);
  if (!Number.isFinite(mad) || mad === 0) return new Set<number>();
  const denom = 1.4826 * mad;
  const out = new Set<number>();
  values.forEach((v, idx) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return;
    if (v <= m) return; // only upper-tail spikes
    const rz = Math.abs((v - m) / denom);
    if (rz >= z) out.add(idx);
  });
  return out;
};

const buildRangesFromMask = (
  data: any[],
  mask: boolean[],
  minLen = 3
): Array<{ x1: string; x2: string }> => {
  const ranges: Array<{ x1: string; x2: string }> = [];
  let start = -1;
  for (let i = 0; i < mask.length; i++) {
    const on = !!mask[i];
    if (on && start === -1) start = i;
    const endNow = (!on || i === mask.length - 1) && start !== -1;
    if (endNow) {
      const end = on && i === mask.length - 1 ? i : i - 1;
      if (end - start + 1 >= minLen) {
        const x1 = data[start]?.timestamp;
        const x2 = data[end]?.timestamp;
        if (x1 != null && x2 != null) ranges.push({ x1, x2 });
      }
      start = -1;
    }
  }
  return ranges;
};

const rollingMean = (arr: number[], win: number) => {
  if (arr.length === 0) return [];
  const w = Math.max(3, win | 0);
  const out = new Array(arr.length).fill(0);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
    if (i >= w) sum -= arr[i - w];
    const denom = Math.min(i + 1, w);
    out[i] = sum / denom;
  }
  return out;
};

const stddev = (arr: number[]) => {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const v =
    arr.reduce((acc, x) => {
      const d = x - mean;
      return acc + d * d;
    }, 0) / arr.length;
  return Math.sqrt(v);
};

export const PerformanceCharts: React.FC<ChartsProps> = ({
  data,
  selectedProcesses,
  hiddenPids,
  onToggleVisibility,
  mode,
  metricStandard,
}) => {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const gridStroke = isDark ? "#1e293b" : "#e2e8f0"; // slate-800 / slate-200
  const axisStroke = isDark ? "#475569" : "#94a3b8"; // slate-600 / slate-400
  const tickFill = isDark ? "#94a3b8" : "#64748b"; // slate-400 / slate-500

  const [viewMode, setViewMode] = useState<"combined" | "split">("combined");
  const [showAnomalyDots, setShowAnomalyDots] = useState(true);
  const [showAnnotations, setShowAnnotations] = useState(true);

  const tsToIndex = useMemo(() => {
    const m = new Map<string, number>();
    data?.forEach((d, i) => {
      const ts = d?.timestamp;
      if (ts != null) m.set(String(ts), i);
    });
    return m;
  }, [data]);

  const getLatestMetric = (pid: number, prefix: string): number | undefined => {
    const key = `${prefix}_${pid}`;
    for (let i = data.length - 1; i >= 0; i--) {
      const v = data[i]?.[key];
      if (typeof v === "number" && !Number.isNaN(v)) return v;
    }
    return undefined;
  };

  // Prefer stability over "latest-only" key selection: pick the metric key prefix
  // that exists for the largest number of samples for this PID.
  const countDefined = (pid: number, prefix: string): number => {
    const key = `${prefix}_${pid}`;
    let n = 0;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]?.[key];
      if (typeof v === "number" && Number.isFinite(v)) n++;
    }
    return n;
  };

  const chooseBestPrefix = (pid: number, candidates: string[]) => {
    let best = candidates[0] ?? "cpuos";
    let bestN = -1;
    for (const pfx of candidates) {
      const n = countDefined(pid, pfx);
      if (n > bestN) {
        bestN = n;
        best = pfx;
      }
    }
    return best;
  };

  const latestTimestamp = data.length
    ? data[data.length - 1]?.timestamp
    : undefined;
  const preferChromeCpu = mode === "browser" && metricStandard === "chrome";
  const preferChromeMem = mode === "browser" && metricStandard === "chrome";

  // Identify PIDs that are "Log Only" (have custom metrics but 0 or missing CPU/Memory).
  // We don't want to clutter the main CPU/Memory charts with flat lines for these.
  const logOnlyPids = useMemo(() => {
    const candidates = new Set<number>();
    const hasSystemData = new Set<number>();

    // First, gather all PIDs that have ANY data
    data.forEach(d => {
        Object.keys(d).forEach(k => {
            const parts = k.split('_');
            const pidStr = parts[parts.length - 1];
            const pid = parseInt(pidStr, 10);
            if (!isNaN(pid)) {
                if (k.startsWith('custom_')) {
                    candidates.add(pid);
                } else if ((k.startsWith('cpu') || k.startsWith('rss') || k.startsWith('pmem') || k.startsWith('foot'))) {
                     const v = d[k];
                     if (typeof v === 'number' && v > 0) {
                         hasSystemData.add(pid);
                     }
                }
            }
        });
    });
    
    // PIDs that have custom metrics but NO significant system data
    const logOnly = new Set<number>();
    candidates.forEach(pid => {
        if (!hasSystemData.has(pid)) {
            logOnly.add(pid);
        }
    });
    return logOnly;
  }, [data]);

  // CPU chart annotations (combined view): highlight sustained high total CPU and mark change points.
  const cpuAnnotations = useMemo(() => {
    if (!data?.length || !selectedProcesses?.length) {
      return {
        highRanges: [] as Array<{ x1: string; x2: string }>,
        changeLines: [] as string[],
      };
    }

    // Determine which CPU key each PID contributes (matching the chart line selection).
    const cpuKeys: string[] = [];
    selectedProcesses.forEach((p) => {
      if (hiddenPids.has(p.pid)) return;
      const prefix = chooseBestPrefix(
        p.pid,
        preferChromeCpu ? ["cpuch", "cpuos", "cpu"] : ["cpuos", "cpu"]
      );
      cpuKeys.push(`${prefix}_${p.pid}`);
    });
    if (cpuKeys.length === 0) {
      return {
        highRanges: [] as Array<{ x1: string; x2: string }>,
        changeLines: [] as string[],
      };
    }

    const totals: number[] = data.map((d) => {
      let sum = 0;
      cpuKeys.forEach((k) => {
        const v = d?.[k];
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      });
      return sum;
    });

    // High CPU threshold:
    // - Use a conservative default (60%) and also adapt to workload via p95, whichever is higher.
    const finiteTotals = totals.filter((v) => Number.isFinite(v));
    const p95 = finiteTotals.length
      ? median(
          [...finiteTotals]
            .sort((a, b) => a - b)
            .slice(Math.floor(finiteTotals.length * 0.95))
        )
      : 0;
    const threshold = Math.max(60, Number.isFinite(p95) ? p95 : 0);
    const highMask = totals.map((v) => Number.isFinite(v) && v >= threshold);
    const highRanges = buildRangesFromMask(data, highMask, 3);

    // Change points: large shift in rolling mean.
    const rm = rollingMean(totals, 12);
    const diffs = rm.map((v, i) => (i === 0 ? 0 : v - rm[i - 1]));
    const s = stddev(diffs.filter((v) => Number.isFinite(v)));
    const changeLines: string[] = [];
    if (s > 0) {
      for (let i = 1; i < diffs.length; i++) {
        if (Math.abs(diffs[i]) > 3 * s) {
          const x = data[i]?.timestamp;
          if (x != null) changeLines.push(x);
        }
      }
    }

    return { highRanges, changeLines };
  }, [data, selectedProcesses, hiddenPids, preferChromeCpu]);

  // Memory chart annotations (combined view): sustained high total memory + change points.
  const memAnnotations = useMemo(() => {
    if (!data?.length || !selectedProcesses?.length) {
      return {
        highRanges: [] as Array<{ x1: string; x2: string }>,
        changeLines: [] as string[],
      };
    }
    const memKeys: string[] = [];
    selectedProcesses.forEach((p) => {
      if (hiddenPids.has(p.pid)) return;
      const prefix = chooseBestPrefix(
        p.pid,
        preferChromeMem ? ["pmem", "foot", "rss"] : ["foot", "rss"]
      );
      memKeys.push(`${prefix}_${p.pid}`);
    });
    if (memKeys.length === 0) {
      return {
        highRanges: [] as Array<{ x1: string; x2: string }>,
        changeLines: [] as string[],
      };
    }

    const totalsBytes: number[] = data.map((d) => {
      let sum = 0;
      memKeys.forEach((k) => {
        const v = d?.[k];
        if (typeof v === "number" && Number.isFinite(v)) sum += v;
      });
      return sum;
    });

    // Threshold: max(1GB, p95 total)
    const finite = totalsBytes.filter((v) => Number.isFinite(v));
    const sorted = [...finite].sort((a, b) => a - b);
    const idx = Math.round((sorted.length - 1) * 0.95);
    const p95 = sorted.length
      ? sorted[Math.min(Math.max(idx, 0), sorted.length - 1)]
      : 0;
    const threshold = Math.max(
      1024 * 1024 * 1024,
      Number.isFinite(p95) ? p95 : 0
    );
    const highMask = totalsBytes.map(
      (v) => Number.isFinite(v) && v >= threshold
    );
    const highRanges = buildRangesFromMask(data, highMask, 3);

    const rm = rollingMean(totalsBytes, 12);
    const diffs = rm.map((v, i) => (i === 0 ? 0 : v - rm[i - 1]));
    const s = stddev(diffs.filter((v) => Number.isFinite(v)));
    const changeLines: string[] = [];
    if (s > 0) {
      for (let i = 1; i < diffs.length; i++) {
        if (Math.abs(diffs[i]) > 3 * s) {
          const x = data[i]?.timestamp;
          if (x != null) changeLines.push(x);
        }
      }
    }

    return { highRanges, changeLines };
  }, [data, selectedProcesses, hiddenPids, preferChromeMem]);

  // Pre-compute anomaly indexes for each visible series (CPU + Memory).
  const anomalyIndexBySeriesKey = useMemo(() => {
    const map = new Map<string, Set<number>>();
    if (!data?.length || !selectedProcesses?.length) return map;

    // CPU keys
    selectedProcesses.forEach((p) => {
      if (hiddenPids.has(p.pid)) return;
      const cpuPrefix = chooseBestPrefix(
        p.pid,
        preferChromeCpu ? ["cpuch", "cpuos", "cpu"] : ["cpuos", "cpu"]
      );
      const cpuKey = `${cpuPrefix}_${p.pid}`;
      map.set(
        cpuKey,
        madOutlierIndexes(data.map((d) => d?.[cpuKey] as number | undefined))
      );

      // Memory keys
      const memPrefix = chooseBestPrefix(
        p.pid,
        preferChromeMem ? ["pmem", "foot", "rss"] : ["foot", "rss"]
      );
      const memKey = `${memPrefix}_${p.pid}`;
      map.set(
        memKey,
        // For memory we only mark upward spikes (not downward dips).
        madOutlierIndexesUpper(
          data.map((d) => d?.[memKey] as number | undefined)
        )
      );
    });

    return map;
  }, [data, selectedProcesses, hiddenPids, preferChromeCpu, preferChromeMem]);

  const anomalyDot =
    (seriesKey: string) =>
    // Recharts dot renderer
    (props: any) => {
      const idx = props?.index as number;
      const cx = props?.cx as number;
      const cy = props?.cy as number;
      const set = anomalyIndexBySeriesKey.get(seriesKey);
      const isAnomaly =
        Number.isFinite(idx) &&
        Number.isFinite(cx) &&
        Number.isFinite(cy) &&
        !!set &&
        set.has(idx);

      // Recharts' typings expect a ReactElement (not null). Use r=0 for "no dot".
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
        return <circle cx={0} cy={0} r={0} />;
      }

      return isAnomaly ? (
        <circle
          cx={cx}
          cy={cy}
          r={4}
          fill="#fb7185" // rose-400
          stroke={isDark ? "#0f172a" : "#f8fafc"}
          strokeWidth={1.5}
        />
      ) : (
        <circle cx={cx} cy={cy} r={0} fill="transparent" stroke="none" />
      );
    };

  const CpuTooltip = ({ active, label, payload }: any) => {
    if (!active || !payload?.length) return null;
    const idx = tsToIndex.get(String(label));
    const inHigh =
      showAnnotations &&
      cpuAnnotations.highRanges.some(
        (r) => String(label) >= String(r.x1) && String(label) <= String(r.x2)
      );
    const isChange =
      showAnnotations &&
      cpuAnnotations.changeLines.some((x) => String(x) === String(label));
    const anySpike =
      showAnomalyDots &&
      typeof idx === "number" &&
      payload.some((p: any) =>
        anomalyIndexBySeriesKey.get(String(p.dataKey))?.has(idx)
      );

    return (
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100">
        <div className="text-slate-600 mb-1 dark:text-slate-300">
          {new Date(label).toLocaleTimeString()}
        </div>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-4">
            <span className="text-slate-600 dark:text-slate-300">
              {p.name ?? p.dataKey}
            </span>
            <span className="tabular-nums">
              {typeof p.value === "number" ? `${p.value.toFixed(1)}%` : "—"}
            </span>
          </div>
        ))}
        {(inHigh || isChange || anySpike) && (
          <div className="mt-2 pt-2 border-t border-slate-200 text-slate-600 space-y-1 dark:border-slate-800 dark:text-slate-300">
            {inHigh && <div>Annotated: sustained high CPU window</div>}
            {isChange && <div>Annotated: change point (level shift)</div>}
            {anySpike && <div>Annotated: spike (MAD outlier)</div>}
          </div>
        )}
      </div>
    );
  };

  const MemTooltip = ({ active, label, payload }: any) => {
    if (!active || !payload?.length) return null;
    const idx = tsToIndex.get(String(label));
    const inHigh =
      showAnnotations &&
      memAnnotations.highRanges.some(
        (r) => String(label) >= String(r.x1) && String(label) <= String(r.x2)
      );
    const isChange =
      showAnnotations &&
      memAnnotations.changeLines.some((x) => String(x) === String(label));
    const anySpike =
      showAnomalyDots &&
      typeof idx === "number" &&
      payload.some((p: any) =>
        anomalyIndexBySeriesKey.get(String(p.dataKey))?.has(idx)
      );

    return (
      <div className="bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100">
        <div className="text-slate-600 mb-1 dark:text-slate-300">
          {new Date(label).toLocaleTimeString()}
        </div>
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex justify-between gap-4">
            <span className="text-slate-600 dark:text-slate-300">
              {p.name ?? p.dataKey}
            </span>
            <span className="tabular-nums">
              {typeof p.value === "number" ? formatBytes(p.value) : "—"}
            </span>
          </div>
        ))}
        {(inHigh || isChange || anySpike) && (
          <div className="mt-2 pt-2 border-t border-slate-200 text-slate-600 space-y-1 dark:border-slate-800 dark:text-slate-300">
            {inHigh && <div>Annotated: sustained high memory window</div>}
            {isChange && <div>Annotated: change point (level shift)</div>}
            {anySpike && <div>Annotated: spike</div>}
          </div>
        )}
      </div>
    );
  };

  const cpuLabel =
    mode === "browser" && metricStandard === "chrome"
      ? "Chrome Task Manager"
      : "System Task Manager";
  const memLabel =
    mode === "browser" && metricStandard === "chrome"
      ? "Chrome Task Manager"
      : "System Task Manager";

  return (
    <div className="space-y-6">
      {/* Live numeric readouts */}
      {selectedProcesses.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xl dark:bg-slate-900 dark:border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-slate-700 font-medium dark:text-slate-400">
              Live Metrics
            </h3>
            <div className="text-xs text-slate-500">
              {latestTimestamp
                ? new Date(latestTimestamp).toLocaleTimeString()
                : "—"}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {selectedProcesses
                .filter(p => !logOnlyPids.has(p.pid))
                .map((p, idx) => {
              const cpuChrome = getLatestMetric(p.pid, "cpuch");
              // Backward compatibility: some report payloads only have legacy `cpu_${pid}`.
              const cpuOs =
                getLatestMetric(p.pid, "cpuos") ??
                getLatestMetric(p.pid, "cpu");
              const cpu =
                preferChromeCpu && cpuChrome !== undefined
                  ? cpuChrome
                  : cpuOs ?? cpuChrome;

              const memChrome = getLatestMetric(p.pid, "pmem");
              const memRss = getLatestMetric(p.pid, "rss");
              const mem =
                preferChromeMem && memChrome !== undefined
                  ? memChrome
                  : memRss ?? memChrome;

              const rss = getLatestMetric(p.pid, "rss");
              const heap =
                mode === "browser" ? getLatestMetric(p.pid, "heap") : undefined;
              const pmem =
                mode === "browser" ? getLatestMetric(p.pid, "pmem") : undefined;

              return (
                <div
                  key={`live_${p.pid}`}
                  className={`rounded-lg border p-4 bg-slate-50 ${
                    hiddenPids.has(p.pid)
                      ? "border-slate-200 opacity-60 dark:border-slate-800"
                      : "border-slate-200 dark:border-slate-800"
                  } dark:bg-slate-950/50`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div
                      className="text-sm font-medium truncate"
                      title={displayProcessLabel(p)}
                    >
                      {p.alias?.trim() ? p.alias.trim() : (p.title || p.name)}
                    </div>
                    <div
                      className="text-xs text-slate-500 shrink-0"
                      style={{ color: getColor(idx) }}
                    >
                      {p.pid}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-xs text-slate-500 mb-1">
                        CPU ({cpuLabel})
                      </div>
                      <div className="text-lg font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {typeof cpu === "number" ? `${cpu.toFixed(1)}%` : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500 mb-1">
                        Memory ({memLabel}){" "}
                        {mode === "browser"
                          ? preferChromeMem
                            ? "(Footprint)"
                            : "(RSS)"
                          : "(RSS)"}
                      </div>
                      <div className="text-lg font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                        {typeof mem === "number" ? formatBytes(mem) : "—"}
                      </div>
                    </div>
                  </div>

                  {mode === "browser" && (
                    <div className="mt-3 pt-3 border-t border-slate-200 dark:border-slate-800/70">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <div className="text-xs text-slate-500 mb-1">
                            JS Heap
                          </div>
                          <div className="text-base font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                            {typeof heap === "number" ? formatBytes(heap) : "—"}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs text-slate-500 mb-1">
                            Memory (Chrome)
                          </div>
                          <div className="text-base font-semibold text-slate-900 tabular-nums dark:text-slate-100">
                            {typeof pmem === "number" ? formatBytes(pmem) : "—"}
                          </div>
                        </div>
                      </div>
                      {metricStandard === "chrome" &&
                        typeof rss === "number" && (
                          <div className="mt-2 text-xs text-slate-500">
                            OS RSS (reference):{" "}
                            <span className="tabular-nums text-slate-600 dark:text-slate-300">
                              {formatBytes(rss)}
                            </span>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {/* Chart 1: CPU */}
      <div
        className={`bg-white border border-slate-200 rounded-xl p-5 shadow-xl dark:bg-slate-900 dark:border-slate-800 ${
          viewMode === "split" ? "h-auto" : "h-[300px]"
        }`}
      >
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-slate-700 font-medium flex items-center gap-2 dark:text-slate-400">
            <Cpu className="w-4 h-4" /> CPU Load ({cpuLabel})
          </h3>
          <div className="flex items-center gap-3 text-xs text-slate-600 dark:text-slate-400">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAnnotations}
                onChange={(e) => setShowAnnotations(e.target.checked)}
              />
              Bands/Change-lines
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAnomalyDots}
                onChange={(e) => setShowAnomalyDots(e.target.checked)}
              />
              Spike dots
            </label>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 dark:bg-slate-950 dark:border-slate-800">
            <button
              onClick={() => setViewMode("combined")}
              className={`p-1.5 rounded ${
                viewMode === "combined"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              title="Combined View"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("split")}
              className={`p-1.5 rounded ${
                viewMode === "split"
                  ? "bg-white text-slate-900 shadow-sm dark:bg-slate-800 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              }`}
              title="Split View"
            >
              <Rows className="w-4 h-4" />
            </button>
          </div>
        </div>

        {viewMode === "combined" ? (
          <div className="w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                  minTickGap={50}
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={10}
                />
                <YAxis stroke={axisStroke} tick={{ fill: tickFill }} fontSize={12} />
                <Tooltip content={<CpuTooltip />} />
                <Legend
                  onClick={(e) => {
                    const dataKey = e.dataKey as string;
                    if (dataKey) {
                      const parts = dataKey.split("_");
                      if (parts.length === 2) {
                        const pid = parseInt(parts[1], 10);
                        if (!isNaN(pid)) onToggleVisibility(pid);
                      }
                    }
                  }}
                  wrapperStyle={{
                    cursor: "pointer",
                    color: isDark ? "#cbd5e1" : "#334155",
                  }}
                />
                {/* CPU annotations (combined): sustained-high ranges + change points */}
                {showAnnotations &&
                  cpuAnnotations.highRanges.map((r, i) => (
                    <ReferenceArea
                      key={`cpu_high_${i}`}
                      x1={r.x1}
                      x2={r.x2}
                      fill="#fb7185"
                      fillOpacity={0.08}
                      strokeOpacity={0}
                    />
                  ))}
                {showAnnotations &&
                  cpuAnnotations.changeLines
                    .slice(0, 20)
                    .map((x, i) => (
                      <ReferenceLine
                        key={`cpu_cp_${i}`}
                        x={x}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        strokeOpacity={0.6}
                      />
                    ))}
                {selectedProcesses.map((p, idx) => {
                  if (logOnlyPids.has(p.pid)) return null;
                  const keyPrefix = chooseBestPrefix(
                    p.pid,
                    preferChromeCpu
                      ? ["cpuch", "cpuos", "cpu"]
                      : ["cpuos", "cpu"]
                  );
                  return (
                    <Line
                      key={`${keyPrefix}_${p.pid}`}
                      hide={hiddenPids.has(p.pid)}
                      name={displayProcessLabel(p)}
                      type="monotone"
                      dataKey={`${keyPrefix}_${p.pid}`}
                      stroke={getColor(idx)}
                      strokeWidth={2}
                      connectNulls
                      dot={
                        showAnomalyDots
                          ? anomalyDot(`${keyPrefix}_${p.pid}`)
                          : false
                      }
                      isAnimationActive={false}
                    />
                  );
                })}
                <Brush
                  dataKey="timestamp"
                  height={30}
                  stroke="#4f46e5"
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedProcesses
              .filter((p) => !hiddenPids.has(p.pid) && !logOnlyPids.has(p.pid))
              .map((p, idx) => (
                <div
                  key={`cpu_split_${p.pid}`}
                  className="h-[150px] border-b border-slate-200 pb-2 dark:border-slate-800/50"
                >
                  <div className="text-xs text-slate-500 mb-1 flex justify-between">
                    <span>
                      {p.name} ({p.pid})
                    </span>
                    <span style={{ color: getColor(idx) }}>CPU</span>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="timestamp" hide />
                      <YAxis
                        stroke={axisStroke}
                        tick={{ fill: tickFill }}
                        fontSize={10}
                        width={30}
                      />
                      <Tooltip
                        content={<CpuTooltip />}
                        labelStyle={{ display: "none" }}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${chooseBestPrefix(
                          p.pid,
                          preferChromeCpu
                            ? ["cpuch", "cpuos", "cpu"]
                            : ["cpuos", "cpu"]
                        )}_${p.pid}`}
                        stroke={getColor(idx)}
                        strokeWidth={2}
                        connectNulls
                        dot={
                          showAnomalyDots
                            ? anomalyDot(
                                `${chooseBestPrefix(
                                  p.pid,
                                  preferChromeCpu
                                    ? ["cpuch", "cpuos", "cpu"]
                                    : ["cpuos", "cpu"]
                                )}_${p.pid}`
                              )
                            : false
                        }
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
          </div>
        )}
      </div>
      {/* Chart 2: Memory */}
      <div
        className={`bg-white border border-slate-200 rounded-xl p-5 shadow-xl dark:bg-slate-900 dark:border-slate-800 ${
          viewMode === "split" ? "h-auto" : "h-[300px]"
        }`}
      >
        <h3 className="text-slate-700 font-medium mb-4 flex items-center gap-2 dark:text-slate-400">
          <Database className="w-4 h-4" /> Memory Usage ({memLabel}){" "}
          {mode === "browser"
            ? metricStandard === "chrome"
              ? "(Footprint vs JS Heap)"
              : "(RSS vs JS Heap)"
            : "(RSS)"}
        </h3>

        {viewMode === "combined" ? (
          <div className="w-full h-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data}>
                <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                  minTickGap={50}
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={10}
                />
                <YAxis
                  stroke={axisStroke}
                  tick={{ fill: tickFill }}
                  fontSize={12}
                  tickFormatter={(val) => (val / 1024 / 1024).toFixed(0)}
                />
                <Tooltip content={<MemTooltip />} />
                <Legend
                  onClick={(e) => {
                    const dataKey = e.dataKey as string;
                    if (dataKey) {
                      const parts = dataKey.split("_");
                      if (parts.length === 2) {
                        const pid = parseInt(parts[1], 10);
                        if (!isNaN(pid)) onToggleVisibility(pid);
                      }
                    }
                  }}
                  wrapperStyle={{
                    cursor: "pointer",
                    color: isDark ? "#cbd5e1" : "#334155",
                  }}
                />
                {/* Memory annotations (combined): sustained-high ranges + change points */}
                {showAnnotations &&
                  memAnnotations.highRanges.map((r, i) => (
                    <ReferenceArea
                      key={`mem_high_${i}`}
                      x1={r.x1}
                      x2={r.x2}
                      fill="#34d399"
                      fillOpacity={0.08}
                      strokeOpacity={0}
                    />
                  ))}
                {showAnnotations &&
                  memAnnotations.changeLines
                    .slice(0, 20)
                    .map((x, i) => (
                      <ReferenceLine
                        key={`mem_cp_${i}`}
                        x={x}
                        stroke="#f59e0b"
                        strokeDasharray="4 4"
                        strokeOpacity={0.6}
                      />
                    ))}
                {selectedProcesses.map((p, idx) => {
                  if (logOnlyPids.has(p.pid)) return null;
                  const keyPrefix = chooseBestPrefix(
                    p.pid,
                    preferChromeMem ? ["pmem", "foot", "rss"] : ["foot", "rss"]
                  );
                  const seriesLabel =
                    keyPrefix === "pmem"
                      ? "Private/Footprint"
                      : keyPrefix === "foot"
                      ? "Footprint"
                      : "RSS";
                  return (
                    <Line
                      key={`${keyPrefix}_${p.pid}`}
                      hide={hiddenPids.has(p.pid)}
                      name={`${seriesLabel} ${displayProcessLabel(p)}`}
                      type="monotone"
                      dataKey={`${keyPrefix}_${p.pid}`}
                      stroke={getColor(idx)}
                      strokeWidth={2}
                      connectNulls
                      dot={
                        showAnomalyDots
                          ? anomalyDot(`${keyPrefix}_${p.pid}`)
                          : false
                      }
                      isAnimationActive={false}
                    />
                  );
                })}
                <Brush
                  dataKey="timestamp"
                  height={30}
                  stroke="#34d399"
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="space-y-4">
            {selectedProcesses
              .filter((p) => !hiddenPids.has(p.pid) && !logOnlyPids.has(p.pid))
              .map((p, idx) => (
                <div
                  key={`mem_split_${p.pid}`}
                  className="h-[150px] border-b border-slate-200 pb-2 dark:border-slate-800/50"
                >
                  <div className="text-xs text-slate-500 mb-1 flex justify-between">
                    <span>
                      {p.name} ({p.pid})
                    </span>
                    <span style={{ color: getColor(idx) }}>
                      {mode === "browser" && metricStandard === "chrome"
                        ? "Footprint"
                        : "RSS"}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data}>
                      <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                      <XAxis dataKey="timestamp" hide />
                      <YAxis
                        stroke={axisStroke}
                        tick={{ fill: tickFill }}
                        fontSize={10}
                        width={30}
                        tickFormatter={(val) => (val / 1024 / 1024).toFixed(0)}
                      />
                      <Tooltip
                        content={<MemTooltip />}
                        labelStyle={{ display: "none" }}
                      />
                      <Line
                        type="monotone"
                        dataKey={`${chooseBestPrefix(
                          p.pid,
                          preferChromeMem
                            ? ["pmem", "foot", "rss"]
                            : ["foot", "rss"]
                        )}_${p.pid}`}
                        stroke={getColor(idx)}
                        strokeWidth={2}
                        connectNulls
                        dot={
                          showAnomalyDots
                            ? anomalyDot(
                                `${chooseBestPrefix(
                                  p.pid,
                                  preferChromeMem
                                    ? ["pmem", "foot", "rss"]
                                    : ["foot", "rss"]
                                )}_${p.pid}`
                              )
                            : false
                        }
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ))}
          </div>
        )}
      </div>
      {/* Chart 3: JS Heap (Browser Mode Only) */}
      {mode === "browser" && (
        <div
          className={`bg-white border border-slate-200 rounded-xl p-5 shadow-xl dark:bg-slate-900 dark:border-slate-800 ${
            viewMode === "split" ? "h-auto" : "h-[300px]"
          }`}
        >
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-slate-700 font-medium flex items-center gap-2 dark:text-slate-400">
              <Database className="w-4 h-4" /> JS Heap Size (Browser API)
            </h3>
          </div>

          {viewMode === "combined" ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(time) =>
                      new Date(time).toLocaleTimeString()
                    }
                    minTickGap={50}
                    stroke={axisStroke}
                    tick={{ fill: tickFill }}
                    fontSize={10}
                  />
                  <YAxis
                    stroke={axisStroke}
                    tick={{ fill: tickFill }}
                    fontSize={12}
                    tickFormatter={(val) => formatBytes(val)}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderColor: isDark ? "#334155" : "#e2e8f0",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                    }}
                    labelFormatter={(label) =>
                      new Date(label).toLocaleTimeString()
                    }
                    formatter={(val: number) => [formatBytes(val), ""]}
                  />
                  <Legend
                    onClick={(e) => {
                      const dataKey = e.dataKey as string;
                      if (dataKey) {
                        const parts = dataKey.split("_");
                        if (parts.length >= 2) {
                          const pid = parseInt(parts[parts.length - 1], 10);
                          if (!isNaN(pid)) onToggleVisibility(pid);
                        }
                      }
                    }}
                    wrapperStyle={{
                      cursor: "pointer",
                      color: isDark ? "#cbd5e1" : "#334155",
                    }}
                  />
                  {selectedProcesses.map((p, idx) => (
                    <Line
                      key={`heap_${p.pid}`}
                      hide={hiddenPids.has(p.pid)}
                      name={displayProcessLabel(p)}
                      type="monotone"
                      dataKey={`heap_${p.pid}`}
                      stroke={getColor(idx)}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ))}
                  <Brush
                    dataKey="timestamp"
                    height={30}
                    stroke="#4f46e5"
                    fill={isDark ? "#1e293b" : "#e2e8f0"}
                    tickFormatter={() => ""}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="space-y-4">
              {selectedProcesses
                .filter((p) => !hiddenPids.has(p.pid))
                .map((p, idx) => (
                  <div
                    key={`heap_split_${p.pid}`}
                    className="h-[150px] border-b border-slate-200 pb-2 dark:border-slate-800/50"
                  >
                    <div className="text-xs text-slate-500 mb-1 flex justify-between">
                      <span>
                        {displayProcessLabel(p)}
                      </span>
                      <span style={{ color: getColor(idx) }}>JS Heap</span>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={data}>
                        <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                        <XAxis dataKey="timestamp" hide />
                        <YAxis
                          stroke={axisStroke}
                          tick={{ fill: tickFill }}
                          fontSize={10}
                          width={40}
                          tickFormatter={(val) => formatBytes(val)}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: isDark ? "#0f172a" : "#ffffff",
                            borderColor: isDark ? "#334155" : "#e2e8f0",
                            color: isDark ? "#f1f5f9" : "#0f172a",
                          }}
                          formatter={(val: number) => [formatBytes(val)]}
                          labelFormatter={() => ""}
                        />
                        <Line
                          type="monotone"
                          dataKey={`heap_${p.pid}`}
                          stroke={getColor(idx)}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Chart 4+: Custom Metrics (Dynamically discovered) */}
      {(() => {
        // Map<Prefix, Set<PID>>. Prefix includes "custom_..." but excludes "_PID"
        const customMetricsMap = new Map<string, Set<number>>();
        data.forEach((d) => {
          Object.keys(d).forEach((k) => {
            if (k.startsWith("custom_")) {
              const lastUnderscore = k.lastIndexOf("_");
              if (lastUnderscore === -1) return;
              
              const pidStr = k.substring(lastUnderscore + 1);
              const pid = parseInt(pidStr, 10);
              if (isNaN(pid)) return;
              
              const prefix = k.substring(0, lastUnderscore);
              if (!customMetricsMap.has(prefix)) customMetricsMap.set(prefix, new Set());
              customMetricsMap.get(prefix)?.add(pid);
            }
          });
        });

        return Array.from(customMetricsMap.entries()).map(([prefix, pids]) => {
          const displayName = prefix.replace(/^custom_/, "").replace(/_/g, " ");
          return (
          <div
            key={prefix}
            className={`bg-white border border-slate-200 rounded-xl p-5 shadow-xl dark:bg-slate-900 dark:border-slate-800 ${
              viewMode === "split" ? "h-auto" : "h-[300px]"
            }`}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-slate-700 font-medium flex items-center gap-2 dark:text-slate-400">
                <Activity className="w-4 h-4" /> {displayName}
              </h3>
            </div>

            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
                  <XAxis
                    dataKey="timestamp"
                    tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                    minTickGap={50}
                    stroke={axisStroke}
                    tick={{ fill: tickFill }}
                    fontSize={10}
                  />
                  <YAxis
                    stroke={axisStroke}
                    tick={{ fill: tickFill }}
                    fontSize={12}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: isDark ? "#0f172a" : "#ffffff",
                      borderColor: isDark ? "#334155" : "#e2e8f0",
                      color: isDark ? "#f1f5f9" : "#0f172a",
                    }}
                    labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                  />
                  <Legend />
                  {Array.from(pids).map((pid, idx) => {
                    // Find process info for label/color, or fallback for PID 0 (App Logs) or unselected PIDs.
                    const p = selectedProcesses.find((proc) => proc.pid === pid);
                    
                    // If this is a "Log Only" PID (not in selected list or no system data), make sure we still show it here!
                    // But if user explicitly HID it via legend, respect that.
                    
                    const label = p
                      ? displayProcessLabel(p)
                      : pid === 0
                      ? "App Logs"
                      : `PID ${pid}`;
                    
                    // Use consistent color from selection if available, else derive from PID
                    const color = p
                      ? getColor(selectedProcesses.indexOf(p))
                      : getColor(pid); 

                    if (hiddenPids.has(pid)) return null;

                    const dataKey = `${prefix}_${pid}`;

                    return (
                      <Line
                        key={dataKey}
                        name={label}
                        type="monotone"
                        dataKey={dataKey}
                        stroke={color}
                        strokeWidth={2}
                        connectNulls
                        dot={{ r: 3 }}
                        isAnimationActive={false}
                      />
                    );
                  })}
                  <Brush
                    dataKey="timestamp"
                    height={30}
                    stroke="#8b5cf6"
                    fill={isDark ? "#1e293b" : "#e2e8f0"}
                    tickFormatter={() => ""}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      });
      })()}
    </div>
  );
};
