import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { ArrowLeft, Loader, RotateCcw } from "lucide-react";
import { ProcessList } from "../components/ProcessList";
import type { ProcessInfo } from "../components/Charts";

interface TestContext {
  scenario_name?: string | null;
  build_id?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

interface ReportDetailData {
  id: number;
  created_at: string;
  title: string;
  metrics: Array<any>;
  analysis?: any;
  meta?: any;
}

interface ProcessAlias {
  pid: number;
  alias: string;
}

const genBuildId = () => {
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `bld_${hex}`;
  } catch {
    return `bld_${Math.random().toString(16).slice(2, 10)}`;
  }
};

const parseTags = (text: string) => {
  const parts = (text || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of parts) {
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
};

const tagsToText = (tags: string[]) => tags.join(", ");

const normalize = (s: any) => String(s ?? "").trim().toLowerCase();

export const RetestPreview: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [report, setReport] = useState<ReportDetailData | null>(null);
  const [mode, setMode] = useState<"system" | "browser">("system");
  const [intervalMsText, setIntervalMsText] = useState("1000");
  const [durationMinutesText, setDurationMinutesText] = useState("");
  const [durationHint, setDurationHint] = useState<string | null>(null);

  const [scenarioName, setScenarioName] = useState("");
  const [buildId, setBuildId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [notes, setNotes] = useState("");

  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [processAliases, setProcessAliases] = useState<Record<number, string>>({});
  const [filterText, setFilterText] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const [autoSelectedMsg, setAutoSelectedMsg] = useState<string | null>(null);

  const isStartingRef = useRef(false);

  const snapshot = useMemo(() => {
    const arr: any[] = Array.isArray(report?.meta?.process_snapshot)
      ? report!.meta.process_snapshot
      : [];
    return arr;
  }, [report]);

  const prevTargetPids = useMemo(() => {
    const pids: any = report?.meta?.collection?.target_pids;
    return Array.isArray(pids) ? pids.map((n: any) => Number(n)).filter((n: any) => Number.isFinite(n)) : [];
  }, [report]);

  const inferredPidsFromMetrics = useMemo(() => {
    const seen = new Set<number>();
    const batches: any[] = Array.isArray(report?.metrics) ? (report!.metrics as any[]) : [];
    for (const b of batches) {
      const m = b?.metrics ?? {};
      for (const k of Object.keys(m)) {
        const pid = Number(k);
        if (Number.isFinite(pid)) seen.add(pid);
      }
    }
    return Array.from(seen);
  }, [report]);

  const loadProcesses = async (m: "system" | "browser") => {
    try {
      const list = (await invoke("get_process_list", { mode: m })) as ProcessInfo[];
      setProcesses(list);
      return list;
    } catch (e) {
      console.warn("get_process_list failed", e);
      setProcesses([]);
      return [] as ProcessInfo[];
    }
  };

  const bestEffortMatchSnapshot = (list: ProcessInfo[], m: "system" | "browser") => {
    const byPid = new Map<number, ProcessInfo>();
    list.forEach((p) => byPid.set(p.pid, p));

    const chosen: number[] = [];
    const sourceArr = snapshot.length
      ? snapshot
      : prevTargetPids.length
      ? prevTargetPids.map((pid) => ({ pid }))
      : inferredPidsFromMetrics.length
      ? inferredPidsFromMetrics.map((pid) => ({ pid }))
      : [];
    for (const s of sourceArr) {
      const pid = typeof s?.pid === "number" ? (s.pid as number) : null;
      const title = normalize(s?.title);
      const url = normalize(s?.url);
      const name = normalize(s?.name);
      const procType = normalize(s?.proc_type);

      // 1) Same PID
      if (pid != null && byPid.has(pid)) {
        chosen.push(pid);
        continue;
      }

      // 2) Browser: match by url/title
      if (m === "browser") {
        const found = list.find((p) => {
          const pt = normalize(p.title);
          const pu = normalize(p.url);
          if (url && pu && pu === url) return true;
          if (title && pt && pt === title) return true;
          return false;
        });
        if (found) {
          chosen.push(found.pid);
          continue;
        }
      }

      // 3) System: match by name + proc_type
      const found = list.find((p) => {
        if (!name) return false;
        if (normalize(p.name) !== name) return false;
        if (procType && normalize(p.proc_type) !== procType) return false;
        return true;
      });
      if (found) chosen.push(found.pid);
    }

    const uniq = Array.from(new Set(chosen));
    setSelectedPids(new Set(uniq));
    const wanted = sourceArr.length;
    if (wanted > 0) {
      setAutoSelectedMsg(
        uniq.length === wanted
          ? `Auto-selected ${uniq.length}/${wanted} from the previous run.`
          : `Auto-selected ${uniq.length}/${wanted}. Some processes may have changed — please review.`
      );
    } else {
      setAutoSelectedMsg(
        "No previous selection info found in this report (missing snapshot/target_pids). Please select processes."
      );
    }
  };

  useEffect(() => {
    (async () => {
      if (!id) return;
      setLoading(true);
      try {
        const data = (await invoke("get_report_detail", {
          id: parseInt(id, 10),
        })) as ReportDetailData;
        setReport(data);

        const m: "system" | "browser" =
          (data.meta?.collection?.mode === "browser" ? "browser" : "system") as any;
        setMode(m);

        const interval =
          data.meta?.collection?.interval_ms != null
            ? String(data.meta.collection.interval_ms)
            : "1000";
        setIntervalMsText(interval);

        const stopAfterSeconds = data.meta?.collection?.stop_after_seconds;
        if (typeof stopAfterSeconds === "number" && stopAfterSeconds > 0) {
          setDurationMinutesText(
            (stopAfterSeconds / 60).toFixed(2).replace(/\.?0+$/, "")
          );
          setDurationHint(`Was auto-stopped after ~${stopAfterSeconds}s`);
        }

        const tc: TestContext =
          (data.meta?.test_context ??
            data.meta?.collection?.test_context ??
            {}) as any;

        setScenarioName(tc?.scenario_name ?? "");
        setBuildId(tc?.build_id ?? "");
        setTagsText(Array.isArray(tc?.tags) ? tc.tags.join(", ") : "");
        setNotes(tc?.notes ?? "");

        const list = await loadProcesses(m);
        bestEffortMatchSnapshot(list, m);

        // Prefill process aliases from the report snapshot when available.
        const aliasMap: Record<number, string> = {};
        const snapArr: any[] = Array.isArray(data.meta?.process_snapshot)
          ? data.meta.process_snapshot
          : [];
        snapArr.forEach((p: any) => {
          const pid = Number(p?.pid);
          const alias = String(p?.alias ?? "").trim();
          if (!Number.isFinite(pid) || !alias) return;
          aliasMap[pid] = alias;
        });
        setProcessAliases(aliasMap);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    // When switching mode, reload processes and re-run best-effort match.
    (async () => {
      if (!report) return;
      const list = await loadProcesses(mode);
      bestEffortMatchSnapshot(list, mode);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const handleStart = async () => {
    if (isStartingRef.current) return;
    if (!selectedPids.size) return;
    try {
      isStartingRef.current = true;
      setIsStarting(true);

      const effectiveBuildId = buildId.trim() || genBuildId();
      if (!buildId.trim()) setBuildId(effectiveBuildId);

      const intervalMs = Math.max(200, Math.round(parseFloat(intervalMsText) || 1000));
      const mins = parseFloat(durationMinutesText.trim());
      const stopAfterSeconds =
        Number.isFinite(mins) && mins > 0 ? Math.max(1, Math.round(mins * 60)) : null;

      const tags = parseTags(tagsText);
      const testContext: TestContext = {
        scenario_name: scenarioName.trim() || null,
        build_id: effectiveBuildId,
        tags: tags.length ? tags : null,
        notes: notes.trim() || null,
      };

      const process_aliases: ProcessAlias[] = Array.from(selectedPids)
        .map((pid) => {
          const raw = (processAliases as any)[pid];
          const alias = typeof raw === "string" ? raw.trim() : "";
          return { pid, alias };
        })
        .filter((a) => a.alias.length > 0);

      await invoke("start_collection", {
        config: {
          target_pids: Array.from(selectedPids),
          interval_ms: intervalMs,
          mode: mode,
          test_context: testContext,
          process_aliases,
          stop_after_seconds: stopAfterSeconds,
        },
      });

      // Jump to Dashboard; it will rehydrate from get_collection_status.
      navigate("/");
    } finally {
      setIsStarting(false);
      isStartingRef.current = false;
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-slate-500">
        <Loader className="animate-spin w-6 h-6 mr-2" /> Loading re-test…
      </div>
    );
  }

  if (!report) {
    return (
      <div className="p-8 text-rose-600 dark:text-rose-400">
        Failed to load report.
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      <div className="p-8 max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Link
              to={`/report/${report.id}`}
              className="p-2 hover:bg-slate-100 rounded-lg text-slate-500 dark:hover:bg-slate-900 dark:text-slate-400"
            >
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div className="min-w-0">
              <div className="text-xs text-slate-500 uppercase font-bold">
                Re-test Preview
              </div>
              <div className="text-xl font-bold truncate">
                #{report.id} — {report.title}
              </div>
              <div className="text-sm text-slate-500">
                Original run: {new Date(report.created_at).toLocaleString()}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={isStarting || selectedPids.size === 0}
            onClick={handleStart}
            className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white px-4 py-2 rounded-lg font-medium transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            {isStarting ? "Starting…" : "Confirm & Start"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-1">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-sm font-medium mb-3">Collection Settings</div>

              <div className="space-y-3">
                <div>
                  <div className="text-xs text-slate-500 mb-1">Mode</div>
                  <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                    <button
                      onClick={() => setMode("system")}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        mode === "system"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      System
                    </button>
                    <button
                      onClick={() => setMode("browser")}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        mode === "browser"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      Browser
                    </button>
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Interval (ms)
                  </div>
                  <input
                    value={intervalMsText}
                    onChange={(e) => setIntervalMsText(e.target.value)}
                    inputMode="numeric"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="1000"
                  />
                  <div className="mt-1 text-[11px] text-slate-500">
                    Lower interval = more samples (more overhead).
                  </div>
                </div>

                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Duration (minutes, optional)
                  </div>
                  <input
                    value={durationMinutesText}
                    onChange={(e) => {
                      setDurationMinutesText(e.target.value);
                      const mins = parseFloat(e.target.value.trim());
                      if (Number.isFinite(mins) && mins > 0) {
                        setDurationHint(
                          `Will auto-stop after ~${Math.round(mins * 60)}s`
                        );
                      } else {
                        setDurationHint(null);
                      }
                    }}
                    inputMode="decimal"
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="e.g. 2"
                  />
                  {durationHint ? (
                    <div className="mt-1 text-[11px] text-slate-500">
                      {durationHint}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-3 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
              <div className="text-sm text-slate-500 uppercase font-bold mb-3">
                Test Context (editable)
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-500 mb-1">
                    Scenario Name
                  </div>
                  <input
                    value={scenarioName}
                    onChange={(e) => setScenarioName(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="e.g. Login + Feed scroll"
                  />
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">Build ID</div>
                  <input
                    value={buildId}
                    onChange={(e) => setBuildId(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="e.g. commit SHA / CI build number"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-slate-500 mb-1">
                    Tags (comma-separated)
                  </div>
                  <input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="e.g. smoke, perf, macos"
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="text-xs text-slate-500 mb-1">Notes</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={3}
                    className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    placeholder="Optional context for AI: feature flags, dataset size, etc."
                  />
                </div>
              </div>
              {parseTags(tagsText).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {parseTags(tagsText).map((t) => (
                    <button
                      key={`tag_${t}`}
                      type="button"
                      onClick={() => {
                        const next = parseTags(tagsToText(parseTags(tagsText)))
                          .filter((x) => x.toLowerCase() !== t.toLowerCase());
                        setTagsText(tagsToText(next));
                      }}
                      className="px-2 py-1 rounded-md text-xs bg-indigo-600/10 border border-indigo-500/30 text-indigo-700 hover:bg-indigo-600/15 dark:bg-indigo-600/20 dark:text-indigo-200 dark:hover:bg-indigo-600/30"
                      title="Click to remove"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <div className="text-sm font-medium mb-2">Previous Selection</div>
                <div className="text-xs text-slate-500 mb-3">
                  These were captured at the start of the original run (for reference).
                </div>
                <div className="max-h-[340px] overflow-y-auto custom-scrollbar space-y-2">
                  {snapshot.length ? (
                    snapshot.map((p: any) => (
                      <div
                        key={`snap_${p.pid}`}
                        className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-950/50"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="truncate font-medium">
                            {p.alias ?? p.title ?? p.name ?? `PID ${p.pid}`}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            {p.pid}
                          </div>
                        </div>
                        <div className="text-xs text-slate-500 truncate">
                          {p.proc_type ?? "—"} {p.url ? `• ${p.url}` : ""}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-sm text-slate-500">
                      No snapshot in this report.
                    </div>
                  )}
                </div>
              </div>

              <div className="min-h-[520px] flex">
                <ProcessList
                  processes={processes}
                  selectedPids={selectedPids}
                  processAliases={processAliases}
                  onRenameProcess={(pid, alias) => {
                    setProcessAliases((prev) => {
                      const next = { ...prev };
                      const trimmed = (alias || "").slice(0, 80).trim();
                      if (!trimmed) delete (next as any)[pid];
                      else (next as any)[pid] = trimmed;
                      return next;
                    });
                  }}
                  isCollecting={false}
                  mode={mode}
                  filterText={filterText}
                  durationMinutesText={durationMinutesText}
                  onDurationMinutesTextChange={(val) => {
                    setDurationMinutesText(val);
                    const mins = parseFloat(val.trim());
                    if (Number.isFinite(mins) && mins > 0)
                      setDurationHint(
                        `Will auto-stop after ~${Math.round(mins * 60)}s`
                      );
                    else setDurationHint(null);
                  }}
                  durationHint={durationHint}
                  onFilterChange={setFilterText}
                  onToggleSelection={(pid) => {
                    const next = new Set(selectedPids);
                    if (next.has(pid)) next.delete(pid);
                    else next.add(pid);
                    setSelectedPids(next);
                  }}
                  onRefresh={() => loadProcesses(mode)}
                  onStart={handleStart}
                  onStop={() => {}}
                />
              </div>
            </div>

            {autoSelectedMsg ? (
              <div className="text-xs text-slate-500">{autoSelectedMsg}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};


