import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Link } from 'react-router-dom';
import { ChevronDown, Folder, Plus, ExternalLink, Settings as SettingsIcon, Square } from 'lucide-react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { PerformanceCharts, ProcessInfo } from '../components/Charts';
import { ProcessList } from '../components/ProcessList';
import { LogMetricSettings, LogMetricConfig } from '../components/LogMetricSettings';
import { getServerSyncConfig, stopCollectionAndSyncReport, uploadLocalReport } from '../utils/serverSync';
import { useNotifications } from '../components/Notifications';

interface FolderInfo {
  path: string;
  name?: string;
}

// Types
interface MetricPoint {
  timestamp: string;
  pid: number;
  cpu_usage: number;
  cpu_os_usage: number;
  cpu_chrome_usage?: number | null;
  memory_rss: number;
  memory_footprint?: number | null;
  js_heap_size?: number;
  gpu_usage?: number;
  memory_private?: number;
  custom_metrics?: Record<string, number>;
}

interface BatchMetric {
  timestamp: string;
  metrics: { [pid: number]: MetricPoint };
}

interface TestContext {
  scenario_name?: string | null;
  build_id?: string | null;
  tags?: string[] | null;
  notes?: string | null;
}

interface TagStat {
  tag: string;
  count: number;
}

interface ProcessAlias {
  pid: number;
  alias: string;
}

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

const genBuildId = () => {
  // Short, human-friendly id for reports (no PII).
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

export const Dashboard: React.FC = () => {
  const { pushNotification } = useNotifications();
  // Default to Browser API (Chrome Task Manager metrics).
  const [mode, setMode] = useState<"system" | "browser">("browser");
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  // In Browser API mode, we default to Chrome Task Manager-aligned metrics.
  // If Chrome-aligned fields are missing for a PID, charts automatically fall back to OS metrics.
  const metricStandard: "os" | "chrome" = mode === "browser" ? "chrome" : "os";

  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [hiddenPids, setHiddenPids] = useState<Set<number>>(new Set());
  const [processAliases, setProcessAliases] = useState<Record<number, string>>(
    {}
  );
  const [folderPath, setFolderPath] = useState("");
  const [existingFolders, setExistingFolders] = useState<FolderInfo[]>([]);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [newFolderMode, setNewFolderMode] = useState(false);

  const [isCollecting, setIsCollecting] = useState(false);
  const [chartData, setChartData] = useState<any[]>([]);
  const [filterText, setFilterText] = useState("");
  const [isMocking, setIsMocking] = useState(false);
  const [scenarioName, setScenarioName] = useState("");
  const [buildId, setBuildId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [knownTags, setKnownTags] = useState<TagStat[]>([]);
  const [notes, setNotes] = useState("");
  const [durationMinutesText, setDurationMinutesText] = useState("");
  const [durationHint, setDurationHint] = useState<string | null>(null);
  const [serverConfig, setServerConfig] = useState(() => ({
    serverUrl: localStorage.getItem('perfsight_server_url') ?? "",
  }));
  const [syncStatus, setSyncStatus] = useState<{
    state: "idle" | "uploading" | "success" | "error";
    message: string;
    reportId?: number;
  }>({ state: "idle", message: "" });

  // Persistent Log Metric Configs
  const [logConfigs, setLogConfigs] = useState<LogMetricConfig[]>(() => {
    try {
      const saved = localStorage.getItem('perfsight_log_configs');
      return saved ? JSON.parse(saved) : [
        // Default example
        { name: "Inference Time", pattern: "(?i)inference.*?:\s*(\d+(\.\d+)?)", unit: "ms" }
      ];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem('perfsight_log_configs', JSON.stringify(logConfigs));
  }, [logConfigs]);

  useEffect(() => {
    let active = true;
    getServerSyncConfig()
      .then((config) => {
        if (!active) return;
        setServerConfig(config);
      })
      .catch((error) => console.error("Could not load Server settings", error));
    return () => { active = false; };
  }, []);

  const maxDataPoints = 3600;
  const mockTimerRef = useRef<any>(null);
  const unlistenRef = useRef<null | (() => void)>(null);
  const isRehydratingRef = useRef(false);
  const autoStopTimeoutRef = useRef<any>(null);
  const isCollectingRef = useRef(false);
  const autoStopDeadlineMsRef = useRef<number | null>(null);

  useEffect(() => {
    isCollectingRef.current = isCollecting;
  }, [isCollecting]);

  useEffect(() => {
    // On mount (or when returning to this route), sync UI with backend collection state.
    (async () => {
      try {
        isRehydratingRef.current = true;
        await ensureMetricListener();
        // Load known tags (best-effort).
        try {
          const stats = (await invoke("get_known_tags")) as TagStat[];
          setKnownTags(stats || []);
        } catch {
          // ignore
        }
        // Load existing folders (best-effort).
        try {
          const folders = (await invoke("list_folder_paths")) as FolderInfo[];
          setExistingFolders(folders || []);
        } catch {
          // ignore
        }
        const status = (await invoke("get_collection_status")) as {
          is_running: boolean;
          target_pids: number[];
          mode: "system" | "browser";
          test_context?: TestContext | null;
          process_aliases?: ProcessAlias[] | null;
          folder_path?: string | null;
          started_at?: string | null;
          stop_after_seconds?: number | null;
        };

        if (status?.is_running) {
          setIsMocking(false);
          setIsCollecting(true);
          setSelectedPids(new Set(status.target_pids || []));
          setHiddenPids(new Set());
          setMode(status.mode || "system");
          if (status.test_context) {
            setScenarioName(status.test_context.scenario_name ?? "");
            setBuildId(status.test_context.build_id ?? "");
            setTagsText((status.test_context.tags ?? []).join(", "));
            setNotes(status.test_context.notes ?? "");
          }
          if (status.process_aliases && Array.isArray(status.process_aliases)) {
            const map: Record<number, string> = {};
            for (const a of status.process_aliases) {
              const pid = Number((a as any).pid);
              const alias = String((a as any).alias || "").trim();
              if (!Number.isFinite(pid) || !alias) continue;
              map[pid] = alias;
            }
            setProcessAliases(map);
          }
          if (typeof status.folder_path === "string") {
            setFolderPath(status.folder_path);
          }

          // Rehydrate auto-stop timer if configured.
          if (status.stop_after_seconds && status.started_at) {
            const startedMs = Date.parse(status.started_at);
            if (!Number.isNaN(startedMs)) {
              const deadline = startedMs + status.stop_after_seconds * 1000;
              autoStopDeadlineMsRef.current = deadline;
              const remainingMs = deadline - Date.now();
              setDurationMinutesText(
                (status.stop_after_seconds / 60)
                  .toFixed(2)
                  .replace(/\.?0+$/, "")
              );
              if (remainingMs <= 0) {
                // Already overdue -> stop immediately.
                try {
                  const stopResult = await stopCollectionAndSyncReport();
                  if (stopResult.uploaded && stopResult.reportId) {
                    setSyncStatus({ state: "success", message: `Uploaded report #${stopResult.reportId}`, reportId: stopResult.reportId });
                    pushNotification("Report uploaded", `Report #${stopResult.reportId} was sent to the PerfSight Server.`, "success");
                  } else if (stopResult.uploadError && stopResult.reportId) {
                    setSyncStatus({ state: "error", message: stopResult.uploadError, reportId: stopResult.reportId });
                    pushNotification("Report upload failed", stopResult.uploadError, "error", { label: "Retry upload", onClick: () => { void retryServerUpload(stopResult.reportId); } });
                  } else if (stopResult.uploadError) {
                    setSyncStatus({ state: "error", message: stopResult.uploadError });
                    pushNotification("Report upload failed", stopResult.uploadError, "error");
                  } else if (stopResult.saved && stopResult.reportId) {
                    pushNotification("Report saved locally", serverConfig.serverUrl ? "Server upload did not start." : "Configure a Server URL in Settings to upload reports.", "info");
                  }
                  setIsCollecting(false);
                  setDurationHint(null);
                } catch (e) {
                  console.warn("Auto-stop failed during rehydrate", e);
                }
              } else {
                if (autoStopTimeoutRef.current)
                  clearTimeout(autoStopTimeoutRef.current);
                autoStopTimeoutRef.current = setTimeout(() => {
                  if (!isCollectingRef.current) return;
                  handleStop();
                }, remainingMs);
                setDurationHint(
                  `Auto-stop in ~${Math.ceil(remainingMs / 1000)}s`
                );
              }
            }
          } else {
            autoStopDeadlineMsRef.current = null;
            setDurationHint(null);
          }
        } else {
          setIsCollecting(false);
          autoStopDeadlineMsRef.current = null;
          setDurationHint(null);
        }
      } catch (e) {
        console.warn("Failed to rehydrate collection status", e);
      } finally {
        isRehydratingRef.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Enable live preview: Listen to metrics immediately
    ensureMetricListener();
    loadProcesses();
  }, [mode]);

  useEffect(() => {
    // Only clear selection when the user actually stops collection (not when rehydrating on route change).
    if (!isCollecting && !isRehydratingRef.current) {
      setSelectedPids(new Set());
      setHiddenPids(new Set());
    }
  }, [isCollecting]);

  useEffect(() => {
    // Cleanup listener on unmount
    return () => {
      try {
        unlistenRef.current?.();
      } catch {
        // ignore
      } finally {
        unlistenRef.current = null;
      }
    };
  }, []);

  const ensureMetricListener = async () => {
    if (unlistenRef.current) return;
    unlistenRef.current = await listen("new-metric-batch", (event: any) => {
      const batch = event.payload as BatchMetric;
      addBatchMetric(batch);
    });
  };

  const loadProcesses = async () => {
    try {
      const list = (await invoke("get_process_list", {
        mode,
      })) as ProcessInfo[];
      const sorted = list.sort((a, b) => {
        const aSelected = selectedPids.has(a.pid);
        const bSelected = selectedPids.has(b.pid);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        if (a.title && !b.title) return -1;
        if (!a.title && b.title) return 1;
        return b.cpu_usage - a.cpu_usage;
      });
      setProcesses(sorted);
    } catch (e) {
      console.warn("Tauri invoke failed", e);
      // Mock fallback
      setProcesses([
        {
          pid: 1001,
          name: "chrome.exe",
          proc_type: "Browser",
          title: "Mock Main",
          cpu_usage: 1.2,
          memory_usage: 1024 * 1024 * 100,
        },
        {
          pid: 1002,
          name: "chrome.exe",
          proc_type: "Renderer",
          title: "Mock Tab",
          cpu_usage: 5.5,
          memory_usage: 1024 * 1024 * 300,
        },
      ]);
    }
  };

  const handleStart = async () => {
    if (selectedPids.size === 0) return;
    try {
      const pids = Array.from(selectedPids);
      // Listener is already active via useEffect for live preview

      const effectiveBuildId = buildId.trim() || genBuildId();
      if (!buildId.trim()) setBuildId(effectiveBuildId);

      const tags = parseTags(tagsText);
      const testContext: TestContext = {
        scenario_name: scenarioName.trim() || null,
        build_id: effectiveBuildId,
        tags: tags.length ? tags : null,
        notes: notes.trim() || null,
      };

      // Optional duration (minutes) -> seconds.
      const mins = parseFloat(durationMinutesText.trim());
      const stopAfterSeconds =
        Number.isFinite(mins) && mins > 0
          ? Math.max(1, Math.round(mins * 60))
          : null;

      const process_aliases: ProcessAlias[] = pids
        .map((pid) => {
          const raw = (processAliases as any)[pid];
          const alias = typeof raw === "string" ? raw.trim() : "";
          return { pid, alias };
        })
        .filter((a) => a.alias.length > 0);

      await invoke("start_collection", {
        config: {
          target_pids: pids,
          interval_ms: 1000,
          mode: mode,
          folder_path: folderPath.trim() || null,
          test_context: testContext,
          process_aliases,
          stop_after_seconds: stopAfterSeconds,
          // Only relevant in Browser API mode (logs come from extension).
          log_metric_configs: mode === "browser" ? logConfigs : undefined,
        },
      });
      setSyncStatus({ state: "idle", message: "" });
      setIsMocking(false);
      setIsCollecting(true);
      setChartData([]);
      pushNotification("Collection started", `${pids.length} target ${pids.length === 1 ? "process" : "processes"} · ${mode === "system" ? "System Stats" : "Browser Stats"}.`, "success");

      // Schedule auto-stop (frontend-driven), survives route changes via backend rehydration fields.
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      if (stopAfterSeconds) {
        const deadline = Date.now() + stopAfterSeconds * 1000;
        autoStopDeadlineMsRef.current = deadline;
        setDurationHint(`Auto-stop in ~${stopAfterSeconds}s`);
        autoStopTimeoutRef.current = setTimeout(() => {
          if (!isCollectingRef.current) return;
          handleStop();
        }, stopAfterSeconds * 1000);
      } else {
        autoStopDeadlineMsRef.current = null;
        setDurationHint(null);
      }
    } catch (e: any) {
      console.error(e);
      // Only use mock data when starting the real collector fails.
      startMockDataGeneration(Array.from(selectedPids));
      pushNotification("Collector unavailable", "PerfSight is showing simulated metrics because the native collector could not start.", "error");
    }
  };

  const retryServerUpload = async (reportId = syncStatus.reportId) => {
    if (!reportId) return;
    setSyncStatus({ state: "uploading", message: "Retrying Server upload…", reportId });
    try {
      const response = await uploadLocalReport(reportId);
      setSyncStatus({
        state: "success",
        message: `Uploaded report #${reportId}${response.run?.id ? ` · Server ${response.run.id}` : ""}`,
        reportId,
      });
      pushNotification("Report uploaded", `Report #${reportId} was sent to the PerfSight Server.`, "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Server upload failed.";
      setSyncStatus({
        state: "error",
        message,
        reportId,
      });
      pushNotification("Report upload failed", message, "error", { label: "Retry upload", onClick: () => { void retryServerUpload(reportId); } });
    }
  };

  const handleStop = async () => {
    try {
      if (!isMocking) {
        setSyncStatus({ state: "uploading", message: "Saving report and syncing with Server…" });
        const result = await stopCollectionAndSyncReport();
        if (result.uploaded && result.reportId) {
          setSyncStatus({
            state: "success",
            message: `Uploaded report #${result.reportId}${result.serverRunId ? ` · Server ${result.serverRunId}` : ""}`,
            reportId: result.reportId,
          });
          pushNotification("Report uploaded", `Report #${result.reportId} was sent to the PerfSight Server.`, "success");
        } else if (result.uploadError && result.reportId) {
          setSyncStatus({ state: "error", message: result.uploadError, reportId: result.reportId });
          pushNotification("Report upload failed", result.uploadError, "error", { label: "Retry upload", onClick: () => { void retryServerUpload(result.reportId); } });
        } else if (result.uploadError) {
          setSyncStatus({ state: "error", message: result.uploadError });
          pushNotification("Report upload failed", result.uploadError, "error");
        } else if (result.saved && result.reportId) {
          setSyncStatus({
            state: "idle",
            message: serverConfig.serverUrl ? "Report saved locally · Server upload did not start" : "Report saved locally · Configure Server to upload",
            reportId: result.reportId,
          });
          pushNotification("Report saved locally", serverConfig.serverUrl ? "Server upload did not start." : "Configure a Server URL in Settings to upload reports.", "info");
        } else {
          setSyncStatus({ state: "idle", message: "" });
        }
      }
      setIsCollecting(false);
      setIsMocking(false);
      if (mockTimerRef.current) clearInterval(mockTimerRef.current);
      if (autoStopTimeoutRef.current) clearTimeout(autoStopTimeoutRef.current);
      autoStopTimeoutRef.current = null;
      autoStopDeadlineMsRef.current = null;
      setDurationHint(null);
      if (isMocking) pushNotification("Preview collection stopped", "The simulated metrics session has ended.", "info");
    } catch (e) {
      console.error(e);
      pushNotification("Could not stop collection", e instanceof Error ? e.message : "Please try again.", "error");
    }
  };

  const addBatchMetric = (batch: BatchMetric) => {
    // Debug: Check if custom metrics are arriving
    // const hasCustom = Object.values(batch.metrics).some(m => m.custom_metrics);
    // if (hasCustom) console.log("Received Batch with Custom Metrics:", batch);

    setChartData((prev) => {
      const point: any = { timestamp: batch.timestamp };
      Object.entries(batch.metrics).forEach(([pidStr, metric]) => {
        point[`cpu_${pidStr}`] = metric.cpu_usage; // legacy primary
        // Backward-compat: some payloads (or mock data) may not include cpu_os_usage.
        // For System API we can safely fallback to cpu_usage (which is OS CPU in that mode).
        point[`cpuos_${pidStr}`] = metric.cpu_os_usage ?? metric.cpu_usage;
        if (metric.cpu_chrome_usage != null)
          point[`cpuch_${pidStr}`] = metric.cpu_chrome_usage;
        point[`rss_${pidStr}`] = metric.memory_rss;
        if (metric.memory_footprint != null)
          point[`foot_${pidStr}`] = metric.memory_footprint;
        if (metric.memory_private != null)
          point[`pmem_${pidStr}`] = metric.memory_private;
        if (metric.js_heap_size) point[`heap_${pidStr}`] = metric.js_heap_size;
        if (metric.gpu_usage) point[`gpu_${pidStr}`] = metric.gpu_usage;
        if (metric.custom_metrics) {
          Object.entries(metric.custom_metrics).forEach(([key, val]) => {
            const safeKey = key.replace(/[^a-zA-Z0-9]/g, '_');
            point[`custom_${safeKey}_${pidStr}`] = val;
          });
        }
      });
      // Merge same-timestamp batches (can happen when backend receives per-PID websocket frames).
      const last = prev.length ? prev[prev.length - 1] : null;
      const newData =
        last && last.timestamp === batch.timestamp
          ? [...prev.slice(0, -1), { ...last, ...point }]
          : [...prev, point];
      if (newData.length > maxDataPoints)
        return newData.slice(newData.length - maxDataPoints);
      return newData;
    });
  };

  const startMockDataGeneration = (pids: number[]) => {
    if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    setIsMocking(true);
    setIsCollecting(true);
    mockTimerRef.current = setInterval(() => {
      const now = new Date().toISOString();
      const metricsMock: { [key: number]: MetricPoint } = {};
      pids.forEach((pid) => {
        const cpu = Math.random() * 30;
        metricsMock[pid] = {
          timestamp: now,
          pid: pid,
          cpu_usage: cpu,
          cpu_os_usage: cpu,
          memory_rss: 1024 * 1024 * (200 + Math.random() * 50),
        } as any;
      });
      addBatchMetric({ timestamp: now, metrics: metricsMock });
    }, 1000);
  };

  const selectedProcessList = processes.filter((p) => selectedPids.has(p.pid));
  const selectedTags = parseTags(tagsText);
  const knownTagSuggestions = knownTags
    .map((t) => t.tag)
    .filter(
      (t) => !selectedTags.some((s) => s.toLowerCase() === t.toLowerCase())
    )
    .slice(0, 30);

  return (
    <div className="flex flex-col h-full bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      <header className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-6 py-3 bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800 shrink-0">
        <div className="justify-self-start" aria-hidden="true" />

        <div className="justify-self-center">
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
            <button
              onClick={() => !isCollecting && setMode("system")}
              disabled={isCollecting}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "system"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              } ${isCollecting ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              System Stats
            </button>
            <button
              onClick={() => !isCollecting && setMode("browser")}
              disabled={isCollecting}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "browser"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
              } ${isCollecting ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Browser Stats
            </button>
          </div>
        </div>
        <div className="flex items-center justify-self-end gap-3">
          <Link
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <SettingsIcon className="h-4 w-4" />
          </Link>
          <span
            aria-label={syncStatus.state === "uploading" ? "Saving and uploading report" : syncStatus.state === "error" ? "Report upload failed" : isCollecting ? "Collecting" : "Idle"}
            title={syncStatus.state === "uploading" ? "Saving and uploading report" : syncStatus.state === "error" ? "Report upload failed" : isCollecting ? "Collecting" : "Idle"}
            className={`h-2.5 w-2.5 rounded-full ring-4 ${
              syncStatus.state === "uploading"
                ? "animate-pulse bg-amber-500 ring-amber-500/10"
                : syncStatus.state === "error"
                  ? "bg-rose-500 ring-rose-500/10"
                  : isCollecting
                    ? "animate-pulse bg-emerald-500 ring-emerald-500/10"
                    : "bg-slate-300 ring-slate-300/15 dark:bg-slate-600 dark:ring-slate-600/20"
            }`}
          />
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 gap-6 grid grid-cols-1 lg:grid-cols-4 min-h-0">
        {!isCollecting && <div className="lg:col-span-1 h-full overflow-hidden">
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
            isCollecting={isCollecting}
            mode={mode as any}
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
              if (next.has(pid)) {
                next.delete(pid);
                const nextHidden = new Set(hiddenPids);
                nextHidden.delete(pid);
                setHiddenPids(nextHidden);
              } else next.add(pid);
              setSelectedPids(next);
            }}
            onRefresh={loadProcesses}
            onStart={handleStart}
            onStop={handleStop}
          />
        </div>}
        <div className={`${isCollecting ? "lg:col-span-4" : "lg:col-span-3"} h-full overflow-y-auto`}>
          {isCollecting && (
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/70 dark:bg-emerald-950/30">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">Collecting</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{mode === "system" ? "System Stats" : "Browser Stats"}</span>
                <span className="h-3.5 w-px bg-emerald-200 dark:bg-emerald-900" />
                <span className="text-xs text-slate-600 dark:text-slate-300">
                  {selectedProcessList.length} {selectedProcessList.length === 1 ? "process" : "processes"}
                </span>
                <div className="flex min-w-0 flex-wrap gap-1.5">
                  {selectedProcessList.slice(0, 3).map((process) => {
                    const name = processAliases[process.pid]?.trim() || process.title || process.name;
                    return <span key={process.pid} title={name} className="max-w-40 truncate rounded-md bg-white/80 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">{name}</span>;
                  })}
                  {selectedProcessList.length > 3 && <span className="px-1 py-0.5 text-[11px] text-slate-500">+{selectedProcessList.length - 3} more</span>}
                </div>
                {durationHint && <span className="text-[11px] text-slate-500 dark:text-slate-400">{durationHint}</span>}
              </div>
              <button
                type="button"
                onClick={() => void handleStop()}
                className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-rose-500"
              >
                <Square className="h-3.5 w-3.5" /> Stop
              </button>
            </div>
          )}
          <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4 dark:bg-slate-900 dark:border-slate-800">
            <div className="text-sm text-slate-500 uppercase font-bold mb-3">
              Test Context (saved into report metadata)
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="md:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Folder (optional)</div>
                <div className="relative">
                  {newFolderMode ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={folderPath}
                        onChange={(e) => setFolderPath(e.target.value)}
                        disabled={isCollecting}
                        className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                        placeholder="e.g. Release_1.2.3/HomeFeedScroll"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => setNewFolderMode(false)}
                        disabled={isCollecting}
                        className="px-2 py-2 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => !isCollecting && setShowFolderPicker(!showFolderPicker)}
                      disabled={isCollecting}
                      className="w-full flex items-center justify-between bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 hover:border-indigo-400 transition-colors"
                    >
                      <span className="flex items-center gap-2 truncate">
                        <Folder className="w-4 h-4 text-slate-400" />
                        {folderPath || <span className="text-slate-400">Select or create folder...</span>}
                      </span>
                      <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${showFolderPicker ? 'rotate-180' : ''}`} />
                    </button>
                  )}
                  
                  {showFolderPicker && !newFolderMode && (
                    <div className="absolute z-20 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-[200px] overflow-y-auto dark:bg-slate-900 dark:border-slate-700">
                      {/* Root option */}
                      <button
                        type="button"
                        onClick={() => {
                          setFolderPath("");
                          setShowFolderPicker(false);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 ${
                          !folderPath ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : ''
                        }`}
                      >
                        <Folder className="w-4 h-4" />
                        <span className="text-slate-500 italic">Root (no folder)</span>
                      </button>
                      
                      {/* Existing folders */}
                      {existingFolders.filter(f => f.path).map((f) => (
                        <button
                          key={f.path}
                          type="button"
                          onClick={() => {
                            setFolderPath(f.path);
                            setShowFolderPicker(false);
                          }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 ${
                            folderPath === f.path ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300' : ''
                          }`}
                        >
                          <Folder className="w-4 h-4" />
                          {f.path}
                        </button>
                      ))}
                      
                      {/* Create new folder option */}
                      <button
                        type="button"
                        onClick={() => {
                          setShowFolderPicker(false);
                          setNewFolderMode(true);
                        }}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 text-indigo-600 dark:text-indigo-400 border-t border-slate-200 dark:border-slate-700"
                      >
                        <Plus className="w-4 h-4" />
                        Create new folder path...
                      </button>
                    </div>
                  )}
                </div>
                <div className="mt-1 text-[11px] text-slate-500">
                  Used by Reports folder tree. Format: <span className="font-mono">Release/Scenario</span>
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Scenario Name</div>
                <input
                  value={scenarioName}
                  onChange={(e) => setScenarioName(e.target.value)}
                  disabled={isCollecting}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="e.g. Login + Feed scroll"
                />
              </div>
              <div>
                <div className="text-xs text-slate-500 mb-1">Build ID</div>
                <input
                  value={buildId}
                  onChange={(e) => setBuildId(e.target.value)}
                  disabled={isCollecting}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
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
                  disabled={isCollecting}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="e.g. smoke, release:1.2.3, campaign:lab-2026-11-12"
                />
                <div className="mt-1 text-[11px] text-slate-500">
                  Use the same <span className="font-mono">campaign:id</span> tag on every test machine to group one test batch on Server.
                </div>
                {(selectedTags.length > 0 ||
                  knownTagSuggestions.length > 0) && (
                  <div className="mt-2 space-y-2">
                    {selectedTags.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {selectedTags.map((t) => (
                          <button
                            key={`sel-${t}`}
                            type="button"
                            disabled={isCollecting}
                            onClick={() => {
                              const next = selectedTags.filter(
                                (x) => x.toLowerCase() !== t.toLowerCase()
                              );
                              setTagsText(tagsToText(next));
                            }}
                            className="px-2 py-1 rounded-md text-xs bg-indigo-600/10 border border-indigo-500/30 text-indigo-700 hover:bg-indigo-600/15 disabled:opacity-60 dark:bg-indigo-600/20 dark:text-indigo-200 dark:hover:bg-indigo-600/30"
                            title="Click to remove"
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    )}
                    {knownTagSuggestions.length > 0 && (
                      <div>
                        <div className="text-[11px] text-slate-500 mb-1">
                          Previously used tags (click to add)
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {knownTagSuggestions.map((t) => (
                            <button
                              key={`known-${t}`}
                              type="button"
                              disabled={isCollecting}
                              onClick={() => {
                                const next = parseTags(
                                  tagsToText([...selectedTags, t])
                                );
                                setTagsText(tagsToText(next));
                              }}
                              className="px-2 py-1 rounded-md text-xs bg-slate-50 border border-slate-200 text-slate-700 hover:border-slate-300 disabled:opacity-60 dark:bg-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:border-slate-500"
                              title="Click to add"
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="md:col-span-2">
                <div className="text-xs text-slate-500 mb-1">Notes</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  disabled={isCollecting}
                  rows={3}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="Optional context for AI: feature flags, dataset size, etc."
                />
              </div>
            </div>
          </div>

          {mode === "browser" && (
            <div className="mb-4">
              <LogMetricSettings
                configs={logConfigs}
                onChange={setLogConfigs}
                disabled={isCollecting}
                defaultOpen={false}
                showOptionalBadge
              />
            </div>
          )}

          {/* Float Widget Button - shown when collecting */}
          {isCollecting && (
            <div className="mb-4 bg-gradient-to-r from-indigo-500/10 to-violet-500/10 border border-indigo-200 dark:border-indigo-800 rounded-xl p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
                    📍 Minimize and use Float Widget
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Open a small always-on-top widget to monitor metrics while testing
                  </div>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      // Check if widget window already exists
                      const existing = await WebviewWindow.getByLabel('widget');
                      if (existing) {
                        await existing.setFocus();
                        return;
                      }
                      
                      // Create new widget window - compact size
                      const webview = new WebviewWindow('widget', {
                        url: '/widget',
                        title: 'PerfSight Widget',
                        width: 200,
                        height: 128,
                        resizable: false,
                        alwaysOnTop: true,
                        decorations: false,
                        transparent: true,
                        skipTaskbar: true,
                        center: false,
                        x: 50,
                        y: 50,
                      });
                      
                      webview.once('tauri://created', () => {
                        console.log('Widget window created');
                      });
                      webview.once('tauri://error', (e) => {
                        console.error('Failed to create widget window:', e);
                      });
                    } catch (e) {
                      console.error('Failed to open widget:', e);
                    }
                  }}
                  className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Open Float Widget
                </button>
              </div>
            </div>
          )}

          <PerformanceCharts
            data={chartData}
            selectedProcesses={selectedProcessList}
            hiddenPids={hiddenPids}
            onToggleVisibility={(pid) => {
              const next = new Set(hiddenPids);
              if (next.has(pid)) next.delete(pid);
              else next.add(pid);
              setHiddenPids(next);
            }}
            mode={mode as any}
            metricStandard={metricStandard}
          />
        </div>
      </main>

    </div>
  );
};

