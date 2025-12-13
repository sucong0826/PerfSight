import React, { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity } from 'lucide-react';
import { PerformanceCharts, ProcessInfo } from '../components/Charts';
import { ProcessList } from '../components/ProcessList';

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
}

interface BatchMetric {
  timestamp: string;
  metrics: { [pid: number]: MetricPoint };
}

export const Dashboard: React.FC = () => {
  const [mode, setMode] = useState<"system" | "browser">("system");
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [metricStandard, setMetricStandard] = useState<"os" | "chrome">("os");

  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [hiddenPids, setHiddenPids] = useState<Set<number>>(new Set());

  const [isCollecting, setIsCollecting] = useState(false);
  const [chartData, setChartData] = useState<any[]>([]);
  const [filterText, setFilterText] = useState("");
  const [cdpDebugJson, setCdpDebugJson] = useState<string>("");
  const [isMocking, setIsMocking] = useState(false);

  const maxDataPoints = 3600;
  const mockTimerRef = useRef<any>(null);
  const unlistenRef = useRef<null | (() => void)>(null);

  useEffect(() => {
    loadProcesses();
    if (!isCollecting) {
      setSelectedPids(new Set());
      setHiddenPids(new Set());
    }
    // Default standard per mode: Browser API -> Chrome Task Manager, System API -> OS.
    setMetricStandard(mode === "browser" ? "chrome" : "os");
  }, [mode]);

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
      // Make sure event listener is active BEFORE starting collection.
      // If listener setup fails, don't silently fall back to mock; that creates confusing mismatches
      // between live UI and saved reports.
      await ensureMetricListener();

      await invoke("start_collection", {
        config: { target_pids: pids, interval_ms: 1000, mode: mode },
      });
      setIsMocking(false);
      setIsCollecting(true);
      setChartData([]);
    } catch (e: any) {
      console.error(e);
      // Only use mock data when starting the real collector fails.
      startMockDataGeneration(Array.from(selectedPids));
    }
  };

  const handleStop = async () => {
    try {
      if (!isMocking) {
        await invoke("stop_collection");
      }
      setIsCollecting(false);
      setIsMocking(false);
      if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    } catch (e) {
      console.error(e);
    }
  };

  const addBatchMetric = (batch: BatchMetric) => {
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
      });
      const newData = [...prev, point];
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

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-indigo-500" />
          <h1 className="text-xl font-bold">PerfSight</h1>
          <div className="h-6 w-px bg-slate-700 mx-2"></div>

          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => !isCollecting && setMode("system")}
              disabled={isCollecting}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "system"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              } ${isCollecting ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              System API
            </button>
            <button
              onClick={() => !isCollecting && setMode("browser")}
              disabled={isCollecting}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                mode === "browser"
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              } ${isCollecting ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              Browser API
            </button>
          </div>
          {mode === "browser" && (
            <div className="ml-3 flex bg-slate-800 p-1 rounded-lg border border-slate-700">
              <button
                onClick={() => setMetricStandard("chrome")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  metricStandard === "chrome"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Match Chrome Task Manager"
              >
                Chrome Task Manager
              </button>
              <button
                onClick={() => setMetricStandard("os")}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  metricStandard === "os"
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-400 hover:text-slate-200"
                }`}
                title="Match System Task Manager / Activity Monitor (OS metrics)"
              >
                System Task Manager
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          {mode === "browser" && (
            <button
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 transition-colors"
              onClick={async () => {
                try {
                  const res = await invoke("debug_get_cdp_process_info");
                  const text = JSON.stringify(res, null, 2);
                  setCdpDebugJson(text);
                  console.log("CDP SystemInfo.getProcessInfo:", res);
                  try {
                    await navigator.clipboard.writeText(text);
                  } catch {
                    // clipboard may be denied; ignore
                  }
                } catch (e) {
                  console.error(e);
                  setCdpDebugJson(String(e));
                }
              }}
            >
              Dump CDP processInfo
            </button>
          )}
          <div
            className={`px-3 py-1 rounded-full text-sm font-medium ${
              isCollecting
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-slate-800 text-slate-400"
            }`}
          >
            {isCollecting ? "Collecting" : "Idle"}
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 gap-6 grid grid-cols-1 lg:grid-cols-4 min-h-0">
        <div className="lg:col-span-1 h-full overflow-hidden">
          <ProcessList
            processes={processes}
            selectedPids={selectedPids}
            isCollecting={isCollecting}
            mode={mode as any}
            filterText={filterText}
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
        </div>
        <div className="lg:col-span-3 h-full overflow-y-auto">
          {mode === "browser" && cdpDebugJson && (
            <div className="mb-6 bg-slate-900 border border-slate-800 rounded-xl p-4 shadow-xl">
              <div className="flex items-center justify-between mb-3">
                <div className="text-sm font-semibold text-slate-300">
                  CDP `SystemInfo.getProcessInfo` (raw)
                </div>
                <button
                  className="text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 hover:bg-slate-700"
                  onClick={() => setCdpDebugJson("")}
                >
                  Clear
                </button>
              </div>
              <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words max-h-[300px] overflow-auto bg-slate-950/50 border border-slate-800 rounded-lg p-3">
                {cdpDebugJson}
              </pre>
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
            metricStandard={mode === "browser" ? metricStandard : "os"}
          />
        </div>
      </main>
    </div>
  );
};

