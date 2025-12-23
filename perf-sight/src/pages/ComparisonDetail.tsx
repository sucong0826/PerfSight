import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Download,
  GitCompare,
  Loader,
  Save,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush } from "recharts";
import { useTheme } from "../theme";

interface ComparisonDetailData {
  id: number;
  created_at: string;
  title: string;
  folder_path: string;
  tags: string[];
  report_ids: number[];
  baseline_report_id?: number | null;
  cpu_selections_by_id: Record<string, number[]>;
  mem_selections_by_id: Record<string, number[]>;
  meta?: any;
}

interface ReportDetailData {
  id: number;
  title: string;
  created_at: string;
  metrics: Array<{ timestamp: string; metrics: { [pid: string]: any } }>;
  analysis?: any;
  meta?: any;
}

interface ReportSummary {
  id: number;
  created_at: string;
  title: string;
  folder_path?: string;
  tags?: string[];
  duration_seconds?: number;
}

type MetricTab = "cpu" | "mem";

type TagMatchMode = "ANY" | "ALL";

type GroupDef = {
  key: string;
  name: string;
  mode: TagMatchMode;
  tags: string[];
};

type GroupMetricStat = { n: number; avg: number | null; p95: number | null; max: number | null };
type GroupStats = {
  cpu_avg: GroupMetricStat;
  cpu_p95: GroupMetricStat;
  mem_avg_mb: GroupMetricStat;
  mem_p95_mb: GroupMetricStat;
  mem_growth_rate: GroupMetricStat;
  score: GroupMetricStat;
};

type GroupCompareItem = {
  key: string;
  name: string;
  mode: TagMatchMode;
  tags: string[];
  ids: number[];
  stats: GroupStats;
};

type GroupCompareResult = {
  baselineKey: string;
  groups: GroupCompareItem[];
};

const TagMultiSelect: React.FC<{
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}> = ({ options, value, onChange, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(() => new Set(value.map((x) => x.toLowerCase())), [value]);
  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const base = options;
    if (!qq) return base;
    return base.filter((t) => t.toLowerCase().includes(qq));
  }, [options, q]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
      >
        <span className="truncate text-left">
          {value.length ? value.join(", ") : placeholder ?? "选择 tags…"}
        </span>
        <span className="text-xs text-slate-500">{open ? "▴" : "▾"}</span>
      </button>
      {open ? (
        <div className="absolute z-50 mt-2 w-full rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-950">
          <div className="p-2 border-b border-slate-200 dark:border-slate-800">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
              placeholder="搜索 tag…"
              autoFocus
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-900 dark:text-slate-200"
                onClick={() => onChange([])}
              >
                Clear
              </button>
              <button
                type="button"
                className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-900 dark:text-slate-200"
                onClick={() => setOpen(false)}
              >
                Done
              </button>
            </div>
          </div>
          <div className="max-h-[260px] overflow-y-auto custom-scrollbar p-2">
            {filtered.map((t) => {
              const on = selected.has(t.toLowerCase());
              return (
                <button
                  key={`tagopt_${t}`}
                  type="button"
                  onClick={() => {
                    const next = new Set(value.map((x) => x.toLowerCase()));
                    if (next.has(t.toLowerCase())) {
                      onChange(value.filter((x) => x.toLowerCase() !== t.toLowerCase()));
                    } else {
                      onChange([...value, t]);
                    }
                  }}
                  className={`w-full text-left px-3 py-2 rounded-lg border transition-colors text-sm ${
                    on
                      ? "border-indigo-500/30 bg-indigo-600/5 dark:bg-indigo-900/20"
                      : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-900"
                  }`}
                >
                  <span className="font-medium">{t}</span>
                </button>
              );
            })}
            {filtered.length === 0 ? (
              <div className="text-xs text-slate-500 p-3">无匹配 tag</div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
};

const COLORS = {
  BASELINE: "#6366f1",
  PALETTE: ["#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#ec4899"],
};

const uniq = (arr: number[]) => Array.from(new Set(arr.filter((n) => Number.isFinite(n))));

const finite = (arr: Array<number | null | undefined>) =>
  arr.filter((v): v is number => typeof v === "number" && Number.isFinite(v));

const avg = (arr: number[]) =>
  arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : undefined;

const max = (arr: number[]) => (arr.length ? Math.max(...arr) : undefined);

const stddev = (arr: number[]) => {
  if (arr.length < 2) return undefined;
  const m = avg(arr);
  if (m == null) return undefined;
  const v = arr.reduce((s, x) => s + (x - m) * (x - m), 0) / (arr.length - 1);
  return Math.sqrt(v);
};

const ratioAbove = (arr: number[], threshold: number) => {
  if (!arr.length) return undefined;
  let c = 0;
  for (const v of arr) if (v > threshold) c++;
  return c / arr.length;
};

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

const extractProcItems = (r: ReportDetailData | undefined | null) => {
  if (!r) return [] as Array<{ pid: number; label: string; proc_type?: string }>;
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
  const seen: number[] = [];
  (r.metrics ?? []).forEach((b: any) => {
    Object.keys(b?.metrics ?? {}).forEach((pidStr) => {
      const pid = Number(pidStr);
      if (Number.isFinite(pid)) seen.push(pid);
    });
  });
  return uniq(seen).map((pid) => ({ pid, label: `PID ${pid}` }));
};

export const ComparisonDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  const [loading, setLoading] = useState(true);
  const [cmp, setCmp] = useState<ComparisonDetailData | null>(null);
  const [reports, setReports] = useState<ReportDetailData[]>([]);
  const [tab, setTab] = useState<MetricTab>("cpu");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [baselineId, setBaselineId] = useState<number | null>(null);
  const [cpuSelById, setCpuSelById] = useState<Record<number, number[]>>({});
  const [memSelById, setMemSelById] = useState<Record<number, number[]>>({});

  // Editable meta
  const [isEditingMeta, setIsEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [folderDraft, setFolderDraft] = useState("");
  const [tagsDraft, setTagsDraft] = useState("");
  const [isSavingMeta, setIsSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [autoSave, setAutoSave] = useState(true);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [driversExpanded, setDriversExpanded] = useState<Record<number, boolean>>({});
  const [deltaView, setDeltaView] = useState<"compact" | "full">("compact");

  // Report set by tags (for 16 reports comparisons)
  const [allReports, setAllReports] = useState<ReportSummary[]>([]);
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tagMatchMode, setTagMatchMode] = useState<"ANY" | "ALL">("ANY");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isApplyingReportSet, setIsApplyingReportSet] = useState(false);

  // Dynamic tag-group compare (multi-groups)
  const [groups, setGroups] = useState<GroupDef[]>([
    { key: "A", name: "Group A", mode: "ALL", tags: [] },
    { key: "B", name: "Group B", mode: "ALL", tags: [] },
  ]);
  const [baselineGroupKey, setBaselineGroupKey] = useState("A");
  const [groupResult, setGroupResult] = useState<GroupCompareResult | null>(null);
  const [isRunningGroupCompare, setIsRunningGroupCompare] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      try {
        // Load summaries + known tags for tag-based report set.
        const [rs, ts] = (await Promise.all([
          invoke("get_reports"),
          invoke("get_known_tags"),
        ])) as any[];
        setAllReports((rs as any[]) || []);
        setKnownTags(
          Array.isArray(ts)
            ? ts.map((x: any) => String(x?.tag ?? "")).filter(Boolean)
            : []
        );

        const detail = (await invoke("get_comparison_detail", {
          id: Number(id),
        })) as any;
        setCmp(detail);
        setTitleDraft(String(detail?.title ?? ""));
        setFolderDraft(String(detail?.folder_path ?? ""));
        setTagsDraft(Array.isArray(detail?.tags) ? detail.tags.join(", ") : "");

        const reportIds: number[] = Array.isArray(detail.report_ids) ? detail.report_ids : [];
        const rr = (await Promise.all(
          reportIds.map((rid) => invoke("get_report_detail", { id: rid }))
        )) as ReportDetailData[];
        setReports(rr);

        // hydrate config
        const nextBaseline = detail.baseline_report_id != null ? Number(detail.baseline_report_id) : (rr[0]?.id ?? null);
        setBaselineId(nextBaseline);

        const nextCpu: Record<number, number[]> = {};
        const nextMem: Record<number, number[]> = {};
        rr.forEach((r) => {
          const pids = extractProcItems(r).map((p) => p.pid);
          const cpu = detail.cpu_selections_by_id?.[String(r.id)];
          const mem = detail.mem_selections_by_id?.[String(r.id)];
          nextCpu[r.id] = Array.isArray(cpu) ? cpu.map(Number).filter(Number.isFinite) : pids;
          nextMem[r.id] = Array.isArray(mem) ? mem.map(Number).filter(Number.isFinite) : pids;
        });
        setCpuSelById(nextCpu);
        setMemSelById(nextMem);
      } finally {
        setLoading(false);
      }
    })().catch((e) => {
      console.error("load comparison failed", e);
      setLoading(false);
    });
  }, [id]);

  const filteredReportSummaries = useMemo(() => {
    const tags = selectedTags.map((t) => t.trim()).filter(Boolean);
    if (!tags.length) return allReports;
    const has = (r: ReportSummary, t: string) =>
      (r.tags || []).some((x) => String(x).toLowerCase() === t.toLowerCase());
    return allReports.filter((r) => {
      if (!Array.isArray(r.tags) || !r.tags.length) return false;
      if (tagMatchMode === "ALL") return tags.every((t) => has(r, t));
      return tags.some((t) => has(r, t));
    });
  }, [allReports, selectedTags, tagMatchMode]);

  const applyReportSet = async () => {
    if (!cmp) return;
    const ids = filteredReportSummaries.map((r) => r.id).sort((a, b) => a - b);
    if (ids.length < 2) {
      alert("需要至少 2 个 reports 才能进行 comparison。请调整 tag 过滤条件。");
      return;
    }
    try {
      setIsApplyingReportSet(true);
      const nextBaseline =
        baselineId != null && ids.includes(baselineId) ? baselineId : ids[0];

      await invoke("update_comparison_reports", {
        args: { id: cmp.id, reportIds: ids, baselineReportId: nextBaseline },
      } as any);

      const detail = (await invoke("get_comparison_detail", { id: cmp.id })) as any;
      setCmp(detail);
      setBaselineId(nextBaseline);

      const rr = (await Promise.all(
        ids.map((rid) => invoke("get_report_detail", { id: rid }))
      )) as ReportDetailData[];
      setReports(rr);

      // Default selection: all PIDs for the new set (simpler mental model).
      const nextCpu: Record<number, number[]> = {};
      const nextMem: Record<number, number[]> = {};
      rr.forEach((r) => {
        const pids = extractProcItems(r).map((p) => p.pid);
        nextCpu[r.id] = pids;
        nextMem[r.id] = pids;
      });
      setCpuSelById(nextCpu);
      setMemSelById(nextMem);
    } catch (e) {
      console.error("applyReportSet failed", e);
      alert("应用 tag 过滤的 report set 失败");
    } finally {
      setIsApplyingReportSet(false);
    }
  };

  const matchReportsByTags = (pool: ReportSummary[], tags: string[], mode: TagMatchMode) => {
    const ts = tags.map((t) => t.toLowerCase()).filter(Boolean);
    // Empty tags => treat as "all in pool" for convenience (e.g. baseline group = all).
    if (!ts.length) return pool;
    const has = (r: ReportSummary, t: string) =>
      (r.tags || []).some((x) => String(x).toLowerCase() === t);
    return pool.filter((r) => {
      if (!Array.isArray(r.tags) || !r.tags.length) return false;
      if (mode === "ALL") return ts.every((t) => has(r, t));
      return ts.some((t) => has(r, t));
    });
  };

  const runGroupCompare = async () => {
    // IMPORTANT: scope to current comparison's report set (e.g. the imported 16 reports),
    // not global DB reports. This matches the bundle workflow.
    const pool = allReports.filter((r) => (cmp?.report_ids ?? []).includes(r.id));
    if (pool.length < 2) {
      alert("当前 comparison 的 report 数量不足（需要至少 2 个）。");
      return;
    }

    const groupMatches = groups.map((g) => ({
      ...g,
      reports: matchReportsByTags(pool, g.tags, g.mode),
    }));
    const invalid = groupMatches.filter((g) => g.reports.length < 2);
    if (invalid.length) {
      alert(
        `以下 group 命中的 reports 少于 2 个：${invalid
          .map((g) => `${g.name}(${g.reports.length})`)
          .join(", ")}。请调整 tags 或匹配模式。`
      );
      return;
    }

    try {
      setIsRunningGroupCompare(true);

      const loadSummaryById = async (ids: number[]) => {
        const details = (await Promise.all(
          ids.map((rid) => invoke("get_report_detail", { id: rid }))
        )) as any[];
        // extract analysis.summary fields; fallback to undefined
        const rows = details
          .map((d) => ({
            id: Number(d?.id),
            title: String(d?.title ?? ""),
            avg_cpu: d?.analysis?.summary?.avg_cpu,
            p95_cpu: d?.analysis?.summary?.p95_cpu,
            max_cpu: d?.analysis?.summary?.max_cpu,
            avg_mem_mb: d?.analysis?.summary?.avg_mem_mb,
            p95_mem_mb: d?.analysis?.summary?.p95_mem_mb,
            max_mem_mb: d?.analysis?.summary?.max_mem_mb,
            mem_growth_rate: d?.analysis?.summary?.mem_growth_rate,
            score: d?.analysis?.score,
          }))
          .filter((x) => Number.isFinite(x.id));
        const m = new Map<number, any>();
        for (const r of rows) m.set(r.id, r);
        return m;
      };

      const allIds = Array.from(
        new Set(groupMatches.flatMap((g) => g.reports.map((r) => r.id)))
      ).sort((a, b) => a - b);
      const byId = await loadSummaryById(allIds);

      const stat = (arr: any[], key: string) => {
        const vs = arr
          .map((x) => x?.[key])
          .filter((v) => typeof v === "number" && Number.isFinite(v)) as number[];
        return {
          n: vs.length,
          avg: avg(vs) ?? null,
          p95: percentile(vs, 0.95) ?? null,
          max: max(vs) ?? null,
        };
      };

      const items: GroupCompareItem[] = groupMatches.map((g) => {
        const ids = g.reports.map((r) => r.id).sort((a, b) => a - b);
        const arr = ids.map((id) => byId.get(id)).filter(Boolean);
        const stats: GroupStats = {
          cpu_avg: stat(arr, "avg_cpu"),
          cpu_p95: stat(arr, "p95_cpu"),
          mem_avg_mb: stat(arr, "avg_mem_mb"),
          mem_p95_mb: stat(arr, "p95_mem_mb"),
          mem_growth_rate: stat(arr, "mem_growth_rate"),
          score: stat(arr, "score"),
        };
        return {
          key: g.key,
          name: g.name,
          mode: g.mode,
          tags: g.tags,
          ids,
          stats,
        };
      });

      const baselineKey =
        items.some((x) => x.key === baselineGroupKey) ? baselineGroupKey : items[0].key;
      setBaselineGroupKey(baselineKey);
      setGroupResult({ baselineKey, groups: items });
    } catch (e) {
      console.error("runGroupCompare failed", e);
      alert("动态 Tag Group 对比失败（请看 console）");
    } finally {
      setIsRunningGroupCompare(false);
    }
  };

  const parsedTagsDraft = useMemo(() => {
    return tagsDraft
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }, [tagsDraft]);

  const handleSaveMeta = async () => {
    if (!cmp) return;
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setMetaError("Title cannot be empty");
      return;
    }
    setMetaError(null);
    try {
      setIsSavingMeta(true);
      // 1) title
      if (nextTitle !== String(cmp.title ?? "")) {
        await invoke("update_comparison_title", { id: cmp.id, title: nextTitle });
      }
      // 2) folder (kept in both column + meta for portability)
      const nextFolder = folderDraft.trim();
      if (nextFolder !== String(cmp.folder_path ?? "")) {
        await invoke("update_comparison_folder_path", { id: cmp.id, folderPath: nextFolder } as any);
      }
      // 3) tags + folder_path in meta (merge patch)
      await invoke("update_comparison_meta", {
        args: {
          id: cmp.id,
          meta: { tags: parsedTagsDraft, folder_path: nextFolder },
        },
      } as any);

      setCmp({
        ...cmp,
        title: nextTitle,
        folder_path: nextFolder,
        tags: parsedTagsDraft,
        meta: { ...(cmp.meta ?? {}), tags: parsedTagsDraft, folder_path: nextFolder },
      });
      setIsEditingMeta(false);
    } catch (e: any) {
      console.error("save meta failed", e);
      setMetaError(String(e?.message ?? e));
      alert("Failed to save comparison meta");
    } finally {
      setIsSavingMeta(false);
    }
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

  const alignedData = useMemo(() => {
    if (reports.length < 2) return [];
    const baseline = baselineId != null ? reports.find((r) => r.id === baselineId) : null;
    const baseIntervalMs =
      baseline?.meta?.collection?.interval_ms ?? reports[0]?.meta?.collection?.interval_ms ?? 1000;
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
  }, [reports, baselineId, cpuSelById, memSelById]);

  const reportById = useMemo(() => {
    const m = new Map<number, ReportDetailData>();
    reports.forEach((r) => m.set(r.id, r));
    return m;
  }, [reports]);

  const tagPool = useMemo(() => {
    const pool = allReports.filter((r) => (cmp?.report_ids ?? []).includes(r.id));
    const availableTags = Array.from(
      new Set(
        pool
          .flatMap((r) => (Array.isArray(r.tags) ? r.tags : []))
          .map((t) => String(t).trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));
    return { pool, availableTags };
  }, [allReports, cmp?.report_ids]);

  const pidLabel = (r: ReportDetailData, pid: number) => {
    const snap: any[] = Array.isArray(r.meta?.process_snapshot) ? r.meta.process_snapshot : [];
    const s = snap.find((p) => Number(p?.pid) === pid);
    const base = String(s?.alias ?? s?.title ?? s?.name ?? `PID ${pid}`);
    return `${base} (${pid})`;
  };

  const colorById = useMemo(() => {
    const ids = reports.map((r) => r.id);
    const m: Record<number, string> = {};
    let paletteIdx = 0;
    for (const rid of ids) {
      if (baselineId != null && rid === baselineId) {
        m[rid] = COLORS.BASELINE;
        continue;
      }
      m[rid] = COLORS.PALETTE[paletteIdx % COLORS.PALETTE.length];
      paletteIdx++;
    }
    return m;
  }, [reports, baselineId]);

  const tooltipStyle = {
    backgroundColor: isDark ? "#0f172a" : "#ffffff",
    borderColor: isDark ? "#334155" : "#e2e8f0",
    color: isDark ? "#f1f5f9" : "#0f172a",
  } as const;

  const fmtPct = (v?: number) =>
    typeof v === "number" ? `${v.toFixed(1)}%` : "—";
  const fmtMb = (v?: number) =>
    typeof v === "number" ? `${v.toFixed(0)} MB` : "—";

  const handleBack = () => {
    // Prefer back to comparisons list if we came from it.
    const fromComparisons = Boolean((location.state as any)?.fromComparisons);
    if (fromComparisons) {
      navigate(-1);
      return;
    }
    navigate("/comparisons");
  };

  const jumpToReportPid = (reportId: number, pid: number, metric: "cpu" | "mem") => {
    if (!cmp) return;
    navigate(`/report/${reportId}`, {
      state: { fromComparisonId: cmp.id, focusPid: pid, focusMetric: metric },
    });
  };

  const togglePid = (rid: number, pid: number) => {
    const setter = tab === "cpu" ? setCpuSelById : setMemSelById;
    setter((prev) => {
      const arr = prev[rid] ?? [];
      const set = new Set(arr);
      if (set.has(pid)) set.delete(pid);
      else set.add(pid);
      return { ...prev, [rid]: Array.from(set.values()) };
    });
  };

  const handleSave = async () => {
    if (!cmp) return;
    try {
      setIsSaving(true);
      setSaveError(null);
      const cpu: Record<string, number[]> = {};
      const mem: Record<string, number[]> = {};
      Object.entries(cpuSelById).forEach(([k, v]) => (cpu[String(k)] = v));
      Object.entries(memSelById).forEach(([k, v]) => (mem[String(k)] = v));
      await invoke("update_comparison_config", {
        args: {
          id: cmp.id,
          baselineReportId: baselineId,
          cpuSelectionsById: cpu,
          memSelectionsById: mem,
        },
      } as any);
      setLastSavedAt(new Date().toLocaleTimeString());
    } finally {
      setIsSaving(false);
    }
  };

  // Autosave baseline + selections (debounced)
  useEffect(() => {
    if (!cmp) return;
    if (!autoSave) return;
    // avoid autosave while initial load is still happening
    if (loading) return;

    const t = window.setTimeout(async () => {
      try {
        await handleSave();
      } catch (e: any) {
        console.error("autosave failed", e);
        setSaveError(String(e?.message ?? e));
      }
    }, 600);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, cmp?.id, baselineId, cpuSelById, memSelById, loading]);

  const handleExport = async () => {
    if (!cmp) return;
    try {
      setIsExporting(true);
      const out = (await invoke("export_comparison_bundle_json", {
        comparisonId: cmp.id,
        filename: null,
      } as any)) as string;
      alert(`Exported:\n${out}`);
    } finally {
      setIsExporting(false);
    }
  };

  if (loading || !cmp) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader className="animate-spin w-6 h-6 mr-2" /> Loading comparison...
      </div>
    );
  }

  return (
    <div className="h-full flex bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      {/* Left controls panel */}
      <aside className="w-[360px] border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40 overflow-y-auto custom-scrollbar">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-start gap-3">
            <button
              type="button"
              onClick={handleBack}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 dark:hover:bg-slate-900 dark:text-slate-400 shrink-0"
              title="Back"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 uppercase font-bold">Comparison</div>
              <div className="font-bold truncate">{cmp.title}</div>
              <div className="text-xs text-slate-500 mt-1 truncate">
                {cmp.report_ids.length} reports · {cmp.folder_path || "Root"}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs text-slate-500 flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={autoSave}
                  onChange={(e) => setAutoSave(e.target.checked)}
                />
                autosave
              </label>
              {lastSavedAt ? (
                <div className="text-xs text-slate-500">saved {lastSavedAt}</div>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="flex-1 flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
              >
                <Download className="w-4 h-4" /> {isExporting ? "Exporting…" : "Export"}
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                title="Save baseline + PID selections"
              >
                <Save className="w-4 h-4" /> {isSaving ? "Saving…" : "Save"}
              </button>
            </div>
            {saveError ? (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-700 dark:text-rose-200">
                Autosave failed: {saveError}
              </div>
            ) : null}
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* Metric controls */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium mb-2">View</div>
            <div className="flex items-center gap-2">
              {(["cpu", "mem"] as MetricTab[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setTab(k)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                    tab === k
                      ? "bg-indigo-600 text-white"
                      : "bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:hover:bg-slate-800"
                  }`}
                >
                  {k === "cpu" ? "CPU" : "Memory"}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className="ml-auto px-3 py-1.5 rounded-md text-xs font-medium border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-200"
              >
                {showAdvanced ? "Hide advanced" : "Show advanced"}
              </button>
            </div>
          </div>

          {/* Baseline report */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium mb-2">Baseline Report</div>
            <select
              value={baselineId ?? ""}
              onChange={(e) => setBaselineId(e.target.value ? Number(e.target.value) : null)}
              className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
            >
              <option value="">None (overlay)</option>
              {reports.map((r) => (
                <option key={`base_${r.id}`} value={String(r.id)}>
                  #{r.id} — {r.title}
                </option>
              ))}
            </select>
          </div>

          {/* Process selection (parameter) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium mb-2">Process selection</div>
            <div className="text-xs text-slate-500 mb-3">按 {tab === "cpu" ? "CPU" : "Memory"} 维度选择每个 report 的 PID 集合</div>
            <div className="space-y-3">
              {reports.map((r) => {
                const items = extractProcItems(r);
                const selectedArr = tab === "cpu" ? cpuSelById[r.id] ?? [] : memSelById[r.id] ?? [];
                const selected = new Set(selectedArr);
                const allPids = items.map((p) => p.pid);
                const setSelected = (nextArr: number[]) => {
                  if (tab === "cpu") setCpuSelById((prev) => ({ ...prev, [r.id]: nextArr }));
                  else setMemSelById((prev) => ({ ...prev, [r.id]: nextArr }));
                };
                return (
                  <div key={`sel_side_${r.id}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="text-xs font-semibold text-slate-600 dark:text-slate-300 truncate">
                        #{r.id} {r.title}
                        <span className="ml-2 text-[11px] text-slate-500">({selected.size}/{items.length})</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => setSelected(allPids)}
                          className="text-[11px] px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                        >
                          All
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelected([])}
                          className="text-[11px] px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                        >
                          None
                        </button>
                      </div>
                    </div>
                    <div className="max-h-[180px] overflow-y-auto custom-scrollbar space-y-1">
                      {items.map((p) => {
                        const checked = selected.has(p.pid);
                        return (
                          <button
                            key={`${tab}_side_${r.id}_${p.pid}`}
                            type="button"
                            onClick={() => togglePid(r.id, p.pid)}
                            className={`w-full flex items-center justify-between gap-3 px-2 py-2 rounded-lg border text-xs transition-colors ${
                              checked
                                ? "border-indigo-500/30 bg-indigo-600/5 dark:bg-indigo-900/20"
                                : "border-transparent hover:bg-slate-50 dark:hover:bg-slate-900"
                            }`}
                          >
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate font-medium">{p.label}</div>
                              <div className="text-[11px] text-slate-500 truncate">PID {p.pid}</div>
                            </div>
                            <div
                              className={`w-4 h-4 rounded border flex items-center justify-center ${
                                checked
                                  ? "bg-indigo-600 border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500"
                                  : "border-slate-300 dark:border-slate-600"
                              }`}
                            >
                              {checked ? <div className="w-2 h-2 bg-white rounded-sm" /> : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Report Set (by tags) */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium">Report Set</div>
            <div className="text-xs text-slate-500 mb-2">按 tag 选择要参与对比的一组 reports</div>
            <div className="flex items-center gap-2 mb-2">
              <select
                value={tagMatchMode}
                onChange={(e) => setTagMatchMode(e.target.value as any)}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                title="ANY: 任一 tag 命中；ALL: 必须全部命中"
              >
                <option value="ANY">ANY</option>
                <option value="ALL">ALL</option>
              </select>
              <button
                type="button"
                onClick={applyReportSet}
                disabled={isApplyingReportSet}
                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium"
              >
                {isApplyingReportSet ? "Applying…" : `应用 (${filteredReportSummaries.length})`}
              </button>
            </div>
            <div className="max-h-[160px] overflow-y-auto custom-scrollbar flex flex-wrap gap-2">
              {knownTags.map((t) => {
                const on = selectedTags.some((x) => x.toLowerCase() === t.toLowerCase());
                return (
                  <button
                    key={`tagpick_${t}`}
                    type="button"
                    onClick={() => {
                      setSelectedTags((prev) => {
                        const has = prev.some((x) => x.toLowerCase() === t.toLowerCase());
                        if (has) return prev.filter((x) => x.toLowerCase() !== t.toLowerCase());
                        return [...prev, t];
                      });
                    }}
                    className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                      on
                        ? "bg-indigo-600/10 border-indigo-500/30 text-indigo-700 dark:text-indigo-200"
                        : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 dark:bg-slate-950/40 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
              {knownTags.length === 0 ? (
                <div className="text-xs text-slate-500">暂无已知 tags</div>
              ) : null}
            </div>
          </div>

          {/* Dynamic Tag Group Compare controls */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium mb-2">Tag Groups</div>
            <div className="text-xs text-slate-500 mb-3">在当前 comparison 的 report set 内做分组对比</div>
            <div className="flex items-center gap-2 mb-3">
              <button
                type="button"
                onClick={() => {
                  setGroups((prev) => {
                    const nextKey = String.fromCharCode("A".charCodeAt(0) + prev.length);
                    return [
                      ...prev,
                      { key: nextKey, name: `Group ${nextKey}`, mode: "ALL", tags: [] },
                    ];
                  });
                }}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 text-sm"
              >
                + Add Group
              </button>
              <button
                type="button"
                onClick={runGroupCompare}
                disabled={isRunningGroupCompare}
                className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium"
              >
                {isRunningGroupCompare ? "计算中…" : "生成结果"}
              </button>
            </div>

            <div className="flex items-center gap-2 mb-3">
              <div className="text-xs text-slate-500">Baseline</div>
              <select
                value={baselineGroupKey}
                onChange={(e) => setBaselineGroupKey(e.target.value)}
                className="flex-1 bg-white border border-slate-200 rounded-lg px-2 py-2 text-xs text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
              >
                {groups.map((g) => (
                  <option key={`baseopt_${g.key}`} value={g.key}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-3">
              {groups.map((g, idx) => (
                <div key={`grpdef_${g.key}`} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="text-xs font-semibold text-slate-500">{g.name}</div>
                    <div className="flex items-center gap-2">
                      <select
                        value={g.mode}
                        onChange={(e) => {
                          const v = e.target.value as TagMatchMode;
                          setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, mode: v } : x)));
                        }}
                        className="bg-white border border-slate-200 rounded-md px-2 py-1 text-xs text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                      >
                        <option value="ALL">ALL</option>
                        <option value="ANY">ANY</option>
                      </select>
                      {idx >= 2 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setGroups((prev) => prev.filter((x) => x.key !== g.key));
                            if (baselineGroupKey === g.key) setBaselineGroupKey("A");
                          }}
                          className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-100 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-900 dark:text-slate-200"
                        >
                          Remove
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <TagMultiSelect
                    options={tagPool.availableTags}
                    value={g.tags}
                    onChange={(next) => setGroups((prev) => prev.map((x) => (x.key === g.key ? { ...x, tags: next } : x)))}
                    placeholder="不选=全量"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Comparison Meta */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-sm font-medium">Meta</div>
              {!isEditingMeta ? (
                <button
                  type="button"
                  onClick={() => setIsEditingMeta(true)}
                  className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-200"
                >
                  Edit
                </button>
              ) : null}
            </div>

            {metaError ? (
              <div className="mb-2 text-xs text-rose-700 dark:text-rose-200">{metaError}</div>
            ) : null}

            {!isEditingMeta ? (
              <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                <div className="truncate"><span className="text-slate-500">Title:</span> {cmp.title}</div>
                <div className="truncate"><span className="text-slate-500">Folder:</span> {cmp.folder_path || "Root"}</div>
                <div className="truncate"><span className="text-slate-500">Tags:</span> {Array.isArray(cmp.tags) && cmp.tags.length ? cmp.tags.join(", ") : "—"}</div>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                  placeholder="Title"
                />
                <input
                  value={folderDraft}
                  onChange={(e) => setFolderDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                  placeholder="Folder"
                />
                <input
                  value={tagsDraft}
                  onChange={(e) => setTagsDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                  placeholder="Tags (comma separated)"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingMeta(false);
                      setMetaError(null);
                      setTitleDraft(String(cmp.title ?? ""));
                      setFolderDraft(String(cmp.folder_path ?? ""));
                      setTagsDraft(Array.isArray(cmp.tags) ? cmp.tags.join(", ") : "");
                    }}
                    disabled={isSavingMeta}
                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-60 text-slate-700 dark:border-slate-800 dark:hover:bg-slate-800 dark:text-slate-200 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveMeta}
                    disabled={isSavingMeta}
                    className="flex-1 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium"
                  >
                    {isSavingMeta ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main data panel */}
      <main className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {/* Group compare results (data only) */}
        {groupResult ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <div className="text-sm font-medium mb-3">Tag Group Results</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-slate-500 text-xs border-b border-slate-200 dark:border-slate-800">
                    <th className="text-left py-2 pr-3">Metric</th>
                    {groupResult.groups.map((g) => (
                      <th key={`h_${g.key}`} className="text-right py-2 px-3">
                        {g.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-slate-900 dark:text-slate-200">
                  {[
                    ["CPU avg (%)", "cpu_avg"],
                    ["CPU p95 (%)", "cpu_p95"],
                    ["Mem avg (MB)", "mem_avg_mb"],
                    ["Mem p95 (MB)", "mem_p95_mb"],
                    ["Mem growth (MB/s)", "mem_growth_rate"],
                    ["Score", "score"],
                  ].map(([label, key]: any) => {
                    const fmt = (v: any, digits = 2) =>
                      typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
                    const base =
                      groupResult.groups.find((g) => g.key === baselineGroupKey) ??
                      groupResult.groups[0];
                    const baseAvg = (base.stats as any)[key]?.avg;
                    return (
                      <tr key={`grp_${label}`} className="border-b border-slate-200 dark:border-slate-800/50">
                        <td className="py-2 pr-3">{label}</td>
                        {groupResult.groups.map((g) => {
                          const avgV = (g.stats as any)[key]?.avg;
                          const delta =
                            typeof avgV === "number" && typeof baseAvg === "number"
                              ? avgV - baseAvg
                              : null;
                          return (
                            <td key={`c_${label}_${g.key}`} className="py-2 px-3 text-right tabular-nums">
                              {fmt(avgV, 2)}
                              {g.key === base.key ? (
                                <span className="text-xs text-slate-400"> (base)</span>
                              ) : delta == null ? null : (
                                <span className="text-xs text-slate-500">
                                  {" "}
                                  ({delta > 0 ? "+" : ""}
                                  {fmt(delta, 2)})
                                </span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {groupResult.groups.map((g) => (
                <div key={`tagline_${g.key}`}>
                  {g.name} ({g.ids.length}) tags:{" "}
                  <span className="font-mono">{g.tags.length ? g.tags.join(", ") : "—(all)"}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

      {/* Delta + data quality + drivers (aligned with ReportCompare) */}
      {showAdvanced ? (() => {
        const baseline = baselineId != null ? reportById.get(baselineId) : undefined;
        const targets = baseline ? reports.filter((r) => r.id !== baseline.id) : [];

        const t = alignedData.map((d) => d.time_s as number);

        const compareStatsById: Record<
          number,
          {
            cpu_avg?: number;
            cpu_p95?: number;
            cpu_p99?: number;
            cpu_p50?: number;
            cpu_p90?: number;
            cpu_max?: number;
            cpu_stddev?: number;
            cpu_high_ratio_30?: number;
            cpu_high_ratio_60?: number;
            mem_avg_mb?: number;
            mem_p95_mb?: number;
            mem_p99_mb?: number;
            mem_p50_mb?: number;
            mem_p90_mb?: number;
            mem_max_mb?: number;
            mem_stddev_mb?: number;
            mem_high_ratio_512mb?: number;
            mem_high_ratio_1024mb?: number;
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

          const memT: number[] = [];
          const memY: number[] = [];
          alignedData.forEach((d, idx) => {
            const v = d[`mem_${r.id}`];
            if (typeof v === "number" && Number.isFinite(v)) {
              memT.push(t[idx]);
              memY.push(v / 1024 / 1024);
            }
          });

          compareStatsById[r.id] = {
            cpu_avg: avg(cpuVals),
            cpu_p50: percentile(cpuVals, 0.5),
            cpu_p90: percentile(cpuVals, 0.9),
            cpu_p95: percentile(cpuVals, 0.95),
            cpu_p99: percentile(cpuVals, 0.99),
            cpu_max: max(cpuVals),
            cpu_stddev: stddev(cpuVals),
            cpu_high_ratio_30: ratioAbove(cpuVals, 30),
            cpu_high_ratio_60: ratioAbove(cpuVals, 60),
            mem_avg_mb: avg(memMb),
            mem_p50_mb: percentile(memMb, 0.5),
            mem_p90_mb: percentile(memMb, 0.9),
            mem_p95_mb: percentile(memMb, 0.95),
            mem_p99_mb: percentile(memMb, 0.99),
            mem_max_mb: max(memMb),
            mem_stddev_mb: stddev(memMb),
            mem_high_ratio_512mb: ratioAbove(memMb, 512),
            mem_high_ratio_1024mb: ratioAbove(memMb, 1024),
            mem_growth_mb_s: linregSlope(memT, memY),
            samples_total: alignedData.length,
            samples_cpu: cpuVals.length,
            samples_mem: memMb.length,
          };
        }

        const driverDeltas = (() => {
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
              if (d !== 0) cpuDeltas.push({ pid, label: pidLabel(r, pid), delta: d });
            });

            const allMemPids = new Set<number>([
              ...Array.from(baseMemByPid.keys()),
              ...Array.from(memByPid.keys()),
            ]);
            allMemPids.forEach((pid) => {
              const d = (memByPid.get(pid) ?? 0) - (baseMemByPid.get(pid) ?? 0);
              if (d !== 0) memDeltas.push({ pid, label: pidLabel(r, pid), delta: d });
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
        })();

        if (!reports.length) return null;

        const deltaBadge = (delta: number, worseWhenHigher = true) => {
          const worse = worseWhenHigher ? delta > 0 : delta < 0;
          const cls = worse
            ? "text-rose-300 bg-rose-500/10 border-rose-500/30"
            : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
          const arrow = worse ? "↑" : "↓";
          return (
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${cls}`}>
              {arrow} {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}
            </span>
          );
        };

        return (
          <>
            {/* Delta table */}
            {baseline ? (
              <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                  <div className="text-slate-700 dark:text-slate-400 font-medium">
                    Delta vs Baseline (selected processes)
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setDeltaView((v) => (v === "compact" ? "full" : "compact"))}
                      className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                      title="Toggle more columns"
                    >
                      {deltaView === "compact" ? "Show more" : "Show less"}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const colsCompact = [
                            "report",
                            "cpu_avg",
                            "cpu_p95",
                            "mem_avg_mb",
                            "mem_growth_mb_s",
                          ];
                          const colsFull = [
                            "report",
                            "cpu_avg",
                            "cpu_p50",
                            "cpu_p90",
                            "cpu_p95",
                            "cpu_p99",
                            "cpu_max",
                            "cpu_stddev",
                            "cpu_high_ratio_30",
                            "cpu_high_ratio_60",
                            "mem_avg_mb",
                            "mem_p50_mb",
                            "mem_p90_mb",
                            "mem_p95_mb",
                            "mem_p99_mb",
                            "mem_max_mb",
                            "mem_stddev_mb",
                            "mem_high_ratio_512mb",
                            "mem_high_ratio_1024mb",
                            "mem_growth_mb_s",
                          ];
                          const cols = deltaView === "compact" ? colsCompact : colsFull;
                          const header = cols.join(",");
                          const rowFor = (r: ReportDetailData) => {
                            const s = compareStatsById[r.id];
                            const get = (k: string) => {
                              const v: any = (s as any)?.[k];
                              return typeof v === "number" && Number.isFinite(v) ? v : "";
                            };
                            const parts = cols.map((c) => {
                              if (c === "report") return `${r.id}`;
                              return String(get(c));
                            });
                            return parts.join(",");
                          };
                          const csv = [header, rowFor(baseline), ...targets.map(rowFor)].join("\n");
                          await navigator.clipboard.writeText(csv);
                          alert("Copied CSV to clipboard.");
                        } catch (e) {
                          console.error("copy csv failed", e);
                          alert("Failed to copy CSV (clipboard permission?).");
                        }
                      }}
                      className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                      title="Copy as CSV"
                    >
                      Copy CSV
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          const colsCompact = ["Report", "CPU avg", "CPU p95", "Mem avg (MB)", "Mem growth (MB/s)"];
                          const colsFull = [
                            "Report",
                            "CPU avg",
                            "CPU p50",
                            "CPU p90",
                            "CPU p95",
                            "CPU p99",
                            "CPU max",
                            "CPU stddev",
                            "CPU >30%",
                            "CPU >60%",
                            "Mem avg (MB)",
                            "Mem p50",
                            "Mem p90",
                            "Mem p95",
                            "Mem p99",
                            "Mem max",
                            "Mem stddev",
                            "Mem >512MB",
                            "Mem >1GB",
                            "Mem growth (MB/s)",
                          ];
                          const cols = deltaView === "compact" ? colsCompact : colsFull;
                          const sep = "|";
                          const head = `${sep} ${cols.join(` ${sep} `)} ${sep}`;
                          const dash = `${sep} ${cols.map(() => "---").join(` ${sep} `)} ${sep}`;

                          const fmt = (v: any, digits = 2) =>
                            typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";
                          const fmt0 = (v: any) =>
                            typeof v === "number" && Number.isFinite(v) ? String(Math.round(v)) : "—";
                          const fmtPct0 = (v: any) =>
                            typeof v === "number" && Number.isFinite(v) ? `${Math.round(v * 100)}%` : "—";

                          const row = (r: ReportDetailData) => {
                            const s = compareStatsById[r.id];
                            const cellsCompact = [
                              `#${r.id}`,
                              fmt(s.cpu_avg, 1) + "%",
                              fmt(s.cpu_p95, 1) + "%",
                              fmt0(s.mem_avg_mb),
                              fmt(s.mem_growth_mb_s, 2),
                            ];
                            const cellsFull = [
                              `#${r.id}`,
                              fmt(s.cpu_avg, 1) + "%",
                              fmt(s.cpu_p50, 1) + "%",
                              fmt(s.cpu_p90, 1) + "%",
                              fmt(s.cpu_p95, 1) + "%",
                              fmt(s.cpu_p99, 1) + "%",
                              fmt(s.cpu_max, 1) + "%",
                              fmt(s.cpu_stddev, 1),
                              fmtPct0(s.cpu_high_ratio_30),
                              fmtPct0(s.cpu_high_ratio_60),
                              fmt0(s.mem_avg_mb),
                              fmt0(s.mem_p50_mb),
                              fmt0(s.mem_p90_mb),
                              fmt0(s.mem_p95_mb),
                              fmt0(s.mem_p99_mb),
                              fmt0(s.mem_max_mb),
                              fmt0(s.mem_stddev_mb),
                              fmtPct0(s.mem_high_ratio_512mb),
                              fmtPct0(s.mem_high_ratio_1024mb),
                              fmt(s.mem_growth_mb_s, 2),
                            ];
                            const cells = deltaView === "compact" ? cellsCompact : cellsFull;
                            return `${sep} ${cells.join(` ${sep} `)} ${sep}`;
                          };

                          const md = [head, dash, row(baseline), ...targets.map(row)].join("\n");
                          await navigator.clipboard.writeText(md);
                          alert("Copied Markdown to clipboard.");
                        } catch (e) {
                          console.error("copy markdown failed", e);
                          alert("Failed to copy Markdown (clipboard permission?).");
                        }
                      }}
                      className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                      title="Copy as Markdown table"
                    >
                      Copy Markdown
                    </button>
                  </div>
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
                        {deltaView === "full" ? (
                          <>
                            <th className="text-right py-2 px-3">CPU p50</th>
                            <th className="text-right py-2 px-3">CPU p90</th>
                            <th className="text-right py-2 px-3">CPU p99</th>
                            <th className="text-right py-2 px-3">CPU max</th>
                            <th className="text-right py-2 px-3">CPU std</th>
                            <th className="text-right py-2 px-3">CPU &gt;30%</th>
                            <th className="text-right py-2 px-3">CPU &gt;60%</th>
                            <th className="text-right py-2 px-3">Mem p50</th>
                            <th className="text-right py-2 px-3">Mem p90</th>
                            <th className="text-right py-2 px-3">Mem p95</th>
                            <th className="text-right py-2 px-3">Mem p99</th>
                            <th className="text-right py-2 px-3">Mem max</th>
                            <th className="text-right py-2 px-3">Mem std</th>
                            <th className="text-right py-2 px-3">Mem &gt;512MB</th>
                            <th className="text-right py-2 px-3">Mem &gt;1GB</th>
                          </>
                        ) : null}
                      </tr>
                    </thead>
                    <tbody className="text-slate-900 dark:text-slate-200">
                      {/* Baseline row */}
                      <tr className="border-b border-slate-200 dark:border-slate-800/50 bg-slate-50/60 dark:bg-slate-950/30">
                        <td className="py-2 pr-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: colorById[baseline.id] }}
                            />
                            <div className="truncate font-medium">
                              Baseline #{baseline.id} — {baseline.title}
                            </div>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {fmtPct(compareStatsById[baseline.id]?.cpu_avg)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {fmtPct(compareStatsById[baseline.id]?.cpu_p95)}
                        </td>
                        <td className="py-2 px-3 text-right tabular-nums">
                          {fmtMb(compareStatsById[baseline.id]?.mem_avg_mb)}
                        </td>
                        <td className="py-2 pl-3 text-right tabular-nums">
                          {typeof compareStatsById[baseline.id]?.mem_growth_mb_s === "number"
                            ? `${compareStatsById[baseline.id]!.mem_growth_mb_s!.toFixed(2)} MB/s`
                            : "—"}
                        </td>
                        {deltaView === "full" ? (
                          <>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtPct(compareStatsById[baseline.id]?.cpu_p50)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtPct(compareStatsById[baseline.id]?.cpu_p90)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtPct(compareStatsById[baseline.id]?.cpu_p99)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtPct(compareStatsById[baseline.id]?.cpu_max)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.cpu_stddev === "number"
                                ? compareStatsById[baseline.id]!.cpu_stddev!.toFixed(1)
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.cpu_high_ratio_30 === "number"
                                ? `${Math.round(compareStatsById[baseline.id]!.cpu_high_ratio_30! * 100)}%`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.cpu_high_ratio_60 === "number"
                                ? `${Math.round(compareStatsById[baseline.id]!.cpu_high_ratio_60! * 100)}%`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtMb(compareStatsById[baseline.id]?.mem_p50_mb)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtMb(compareStatsById[baseline.id]?.mem_p90_mb)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtMb(compareStatsById[baseline.id]?.mem_p95_mb)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtMb(compareStatsById[baseline.id]?.mem_p99_mb)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">{fmtMb(compareStatsById[baseline.id]?.mem_max_mb)}</td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.mem_stddev_mb === "number"
                                ? compareStatsById[baseline.id]!.mem_stddev_mb!.toFixed(0)
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.mem_high_ratio_512mb === "number"
                                ? `${Math.round(compareStatsById[baseline.id]!.mem_high_ratio_512mb! * 100)}%`
                                : "—"}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">
                              {typeof compareStatsById[baseline.id]?.mem_high_ratio_1024mb === "number"
                                ? `${Math.round(compareStatsById[baseline.id]!.mem_high_ratio_1024mb! * 100)}%`
                                : "—"}
                            </td>
                          </>
                        ) : null}
                      </tr>
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
                            {deltaView === "full" ? (
                              <>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_p50 === "number" && typeof b?.cpu_p50 === "number"
                                    ? deltaBadge(b.cpu_p50 - a.cpu_p50, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_p90 === "number" && typeof b?.cpu_p90 === "number"
                                    ? deltaBadge(b.cpu_p90 - a.cpu_p90, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_p99 === "number" && typeof b?.cpu_p99 === "number"
                                    ? deltaBadge(b.cpu_p99 - a.cpu_p99, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_max === "number" && typeof b?.cpu_max === "number"
                                    ? deltaBadge(b.cpu_max - a.cpu_max, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_stddev === "number" && typeof b?.cpu_stddev === "number"
                                    ? `${(b.cpu_stddev - a.cpu_stddev > 0 ? "+" : "")}${(b.cpu_stddev - a.cpu_stddev).toFixed(1)}`
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_high_ratio_30 === "number" && typeof b?.cpu_high_ratio_30 === "number"
                                    ? `${Math.round((b.cpu_high_ratio_30 - a.cpu_high_ratio_30) * 100)}%`
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.cpu_high_ratio_60 === "number" && typeof b?.cpu_high_ratio_60 === "number"
                                    ? `${Math.round((b.cpu_high_ratio_60 - a.cpu_high_ratio_60) * 100)}%`
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_p50_mb === "number" && typeof b?.mem_p50_mb === "number"
                                    ? deltaBadge(b.mem_p50_mb - a.mem_p50_mb, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_p90_mb === "number" && typeof b?.mem_p90_mb === "number"
                                    ? deltaBadge(b.mem_p90_mb - a.mem_p90_mb, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_p95_mb === "number" && typeof b?.mem_p95_mb === "number"
                                    ? deltaBadge(b.mem_p95_mb - a.mem_p95_mb, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_p99_mb === "number" && typeof b?.mem_p99_mb === "number"
                                    ? deltaBadge(b.mem_p99_mb - a.mem_p99_mb, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_max_mb === "number" && typeof b?.mem_max_mb === "number"
                                    ? deltaBadge(b.mem_max_mb - a.mem_max_mb, true)
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_stddev_mb === "number" && typeof b?.mem_stddev_mb === "number"
                                    ? `${(b.mem_stddev_mb - a.mem_stddev_mb > 0 ? "+" : "")}${(b.mem_stddev_mb - a.mem_stddev_mb).toFixed(0)}`
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_high_ratio_512mb === "number" && typeof b?.mem_high_ratio_512mb === "number"
                                    ? `${Math.round((b.mem_high_ratio_512mb - a.mem_high_ratio_512mb) * 100)}%`
                                    : "—"}
                                </td>
                                <td className="py-2 px-3 text-right tabular-nums">
                                  {typeof a?.mem_high_ratio_1024mb === "number" && typeof b?.mem_high_ratio_1024mb === "number"
                                    ? `${Math.round((b.mem_high_ratio_1024mb - a.mem_high_ratio_1024mb) * 100)}%`
                                    : "—"}
                                </td>
                              </>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  Baseline: #{baseline.id} — {baseline.title} · CPU avg{" "}
                  {fmtPct(compareStatsById[baseline.id]?.cpu_avg)} · Mem avg{" "}
                  {fmtMb(compareStatsById[baseline.id]?.mem_avg_mb)}
                </div>
              </div>
            ) : null}

            {/* Data quality + top drivers */}
            <div className="mb-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            {driversExpanded[d.id] ? "Top 6" : "Top 2"} · click to open report & focus PID
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDriversExpanded((prev) => ({
                                ...prev,
                                [d.id]: !prev[d.id],
                              }))
                            }
                            className="text-xs px-2 py-1 rounded-md border border-slate-200 hover:bg-slate-50 text-slate-700 dark:border-slate-700 dark:hover:bg-slate-800 dark:text-slate-200"
                          >
                            {driversExpanded[d.id] ? "Collapse" : "Expand"}
                          </button>
                        </div>

                        <div className="mt-2 grid grid-cols-1 gap-2">
                          <div className="text-xs font-semibold text-slate-500">CPU</div>
                          {d.topCpu.length ? (
                            <div className="space-y-1">
                              {d.topCpu
                                .slice(0, driversExpanded[d.id] ? 6 : 2)
                                .map((x) => (
                                  <button
                                    key={`drv_cpu_${d.id}_${x.pid}`}
                                    type="button"
                                    onClick={() => jumpToReportPid(d.id, x.pid, "cpu")}
                                    className="w-full text-left text-xs px-2 py-1 rounded-md border border-transparent hover:border-indigo-500/30 hover:bg-indigo-600/5 dark:hover:bg-indigo-900/20"
                                    title="Open report and focus this PID"
                                  >
                                    <span className="font-medium">{x.label}</span>{" "}
                                    <span className="text-slate-500">
                                      ({x.delta > 0 ? "+" : ""}
                                      {x.delta.toFixed(1)}%)
                                    </span>
                                  </button>
                                ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">—</div>
                          )}

                          <div className="text-xs font-semibold text-slate-500 mt-2">Memory</div>
                          {d.topMem.length ? (
                            <div className="space-y-1">
                              {d.topMem
                                .slice(0, driversExpanded[d.id] ? 6 : 2)
                                .map((x) => (
                                  <button
                                    key={`drv_mem_${d.id}_${x.pid}`}
                                    type="button"
                                    onClick={() => jumpToReportPid(d.id, x.pid, "mem")}
                                    className="w-full text-left text-xs px-2 py-1 rounded-md border border-transparent hover:border-indigo-500/30 hover:bg-indigo-600/5 dark:hover:bg-indigo-900/20"
                                    title="Open report and focus this PID"
                                  >
                                    <span className="font-medium">{x.label}</span>{" "}
                                    <span className="text-slate-500">
                                      ({x.delta > 0 ? "+" : ""}
                                      {x.delta.toFixed(0)}MB)
                                    </span>
                                  </button>
                                ))}
                            </div>
                          ) : (
                            <div className="text-xs text-slate-500">—</div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        );
      })() : null}

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="text-sm font-medium mb-3">Reports in this comparison</div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {reports.map((r) => (
            <div
              key={`ctx_${r.id}`}
              className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/40"
              style={{ borderLeftWidth: 4, borderLeftColor: colorById[r.id] }}
            >
              <div className="text-xs text-slate-500 uppercase font-bold mb-1">
                #{r.id} {baselineId === r.id ? "Baseline" : "Report"}
              </div>
              <div className="font-medium truncate">{r.title}</div>
              <div className="text-xs text-slate-500 mt-1">
                {new Date(r.created_at).toLocaleString()}
              </div>
              <div className="mt-2">
                <Link
                  to={`/report/${r.id}`}
                  state={{ fromComparisonId: cmp.id }}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  Open report →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {tab === "cpu" ? (
        <div
          id="cmp-cpu-chart"
          className="bg-white border border-slate-200 rounded-xl p-5 h-[380px] shadow-xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        >
          <h3 className="text-slate-700 dark:text-slate-400 font-medium mb-4 flex items-center gap-2">
            <GitCompare className="w-4 h-4" /> Selected CPU Comparison
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alignedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} />
                <XAxis
                  dataKey="time_s"
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  tick={{ fill: isDark ? "#94a3b8" : "#64748b" }}
                  fontSize={10}
                  tickFormatter={(v: any) => (typeof v === "number" ? String(Math.round(v)) : "")}
                />
                <YAxis
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  tick={{ fill: isDark ? "#94a3b8" : "#64748b" }}
                  fontSize={12}
                  label={{ value: "%", position: "insideLeft", angle: -90 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) => `T+${typeof label === "number" ? Math.round(label) : label}s`}
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
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        ) : null}

        {tab === "mem" ? (
        <div
          id="cmp-mem-chart"
          className="bg-white border border-slate-200 rounded-xl p-5 h-[380px] shadow-xl flex flex-col dark:bg-slate-900 dark:border-slate-800"
        >
          <h3 className="text-slate-700 dark:text-slate-400 font-medium mb-4 flex items-center gap-2">
            <GitCompare className="w-4 h-4" /> Selected Memory Comparison
          </h3>
          <div className="flex-1 min-h-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={alignedData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isDark ? "#1e293b" : "#e2e8f0"} />
                <XAxis
                  dataKey="time_s"
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  tick={{ fill: isDark ? "#94a3b8" : "#64748b" }}
                  fontSize={10}
                  tickFormatter={(v: any) => (typeof v === "number" ? String(Math.round(v)) : "")}
                />
                <YAxis
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  tick={{ fill: isDark ? "#94a3b8" : "#64748b" }}
                  fontSize={12}
                  tickFormatter={(val: any) => (typeof val === "number" ? (val / 1024 / 1024).toFixed(0) : "")}
                  label={{ value: "MB", position: "insideLeft", angle: -90 }}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  labelFormatter={(label) => `T+${typeof label === "number" ? Math.round(label) : label}s`}
                  formatter={(val: any) =>
                    typeof val === "number" ? [(val / 1024 / 1024).toFixed(1) + " MB"] : ["—"]
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
                  stroke={isDark ? "#475569" : "#94a3b8"}
                  fill={isDark ? "#1e293b" : "#e2e8f0"}
                  tickFormatter={() => ""}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        ) : null}
      </div>
      </main>
    </div>
  );
};


