import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Square, Maximize2, GripHorizontal, X } from "lucide-react";

interface BatchMetric {
  timestamp: string;
  metrics: Record<
    number,
    {
      cpu_usage?: number;
      cpu_os_usage?: number;
      cpu_chrome_usage?: number;
      memory_rss?: number;
      memory_private?: number;
      memory_footprint?: number;
    }
  >;
}

interface CollectionStatus {
  is_running: boolean;
  started_at: string | null;
  stop_after_seconds: number | null;
  mode: string | null;
  target_pids: number[];
}

export const FloatingWidget: React.FC = () => {
  const [status, setStatus] = useState<CollectionStatus | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [cpuAvg, setCpuAvg] = useState(0);
  const [cpuMax, setCpuMax] = useState(0);
  const [memAvg, setMemAvg] = useState(0);
  const [memMax, setMemMax] = useState(0);
  const [sampleCount, setSampleCount] = useState(0);
  
  const cpuSumRef = useRef(0);
  const memSumRef = useRef(0);
  const countRef = useRef(0);
  const cpuMaxRef = useRef(0);
  const memMaxRef = useRef(0);

  useEffect(() => {
    // Poll collection status and update elapsed time
    const pollStatus = async () => {
      try {
        const s = (await invoke("get_collection_status")) as CollectionStatus;
        setStatus(s);
        
        if (s.is_running && s.started_at) {
          const startMs = new Date(s.started_at).getTime();
          const nowMs = Date.now();
          setElapsed(Math.floor((nowMs - startMs) / 1000));
        }
      } catch (e) {
        console.error("Failed to get status", e);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 1000);

    // Listen for metrics
    const unlisten = listen<BatchMetric>("new-metric-batch", (event) => {
      const batch = event.payload;
      let batchCpu = 0;
      let batchMem = 0;
      let pidCount = 0;

      Object.values(batch.metrics).forEach((m) => {
        const cpu = m.cpu_chrome_usage ?? m.cpu_os_usage ?? m.cpu_usage ?? 0;
        const mem = (m.memory_private ?? m.memory_footprint ?? m.memory_rss ?? 0) / (1024 * 1024);
        batchCpu += cpu;
        batchMem += mem;
        pidCount++;
      });

      if (pidCount > 0) {
        cpuSumRef.current += batchCpu;
        memSumRef.current += batchMem;
        countRef.current += 1;
        
        if (batchCpu > cpuMaxRef.current) cpuMaxRef.current = batchCpu;
        if (batchMem > memMaxRef.current) memMaxRef.current = batchMem;

        setCpuAvg(cpuSumRef.current / countRef.current);
        setMemAvg(memSumRef.current / countRef.current);
        setCpuMax(cpuMaxRef.current);
        setMemMax(memMaxRef.current);
        setSampleCount(countRef.current);
      }
    });

    return () => {
      clearInterval(interval);
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleStop = async () => {
    try {
      await invoke("stop_collection");
      const mainWindow = await import("@tauri-apps/api/window").then(m => m.Window.getByLabel("main"));
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
    } catch (e) {
      console.error("Failed to stop", e);
    }
  };

  const handleExpand = async () => {
    try {
      const mainWindow = await import("@tauri-apps/api/window").then(m => m.Window.getByLabel("main"));
      if (mainWindow) {
        await mainWindow.show();
        await mainWindow.setFocus();
      }
      const currentWindow = getCurrentWindow();
      await currentWindow.close();
    } catch (e) {
      console.error("Failed to expand", e);
    }
  };

  const handleClose = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.close();
  };

  const handleDragStart = async () => {
    const currentWindow = getCurrentWindow();
    await currentWindow.startDragging();
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const duration = status?.stop_after_seconds ?? 0;
  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;
  const remaining = duration > 0 ? Math.max(0, duration - elapsed) : 0;
  const isRunning = status?.is_running ?? false;

  return (
    <div className="w-full h-full bg-slate-900/95 text-white rounded-xl overflow-hidden shadow-2xl border border-slate-700/50 select-none">
      {/* Custom CSS for breathing animation */}
      <style>{`
        @keyframes breathing {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .breathing {
          animation: breathing 2s ease-in-out infinite;
        }
      `}</style>

      {/* Drag Handle / Header */}
      <div
        className="flex items-center justify-between px-2 py-1 bg-slate-800/80 cursor-move"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-1.5">
          <GripHorizontal className="w-3 h-3 text-slate-500" />
          <span className="text-[10px] font-semibold text-slate-400">PerfSight</span>
          {isRunning && (
            <div className="flex items-center gap-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 breathing" />
              <span className="text-[10px] text-emerald-400 font-medium">Collecting</span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Stop button */}
          <button
            onClick={handleStop}
            disabled={!isRunning}
            className="p-1 rounded hover:bg-rose-600/80 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Stop Collection"
          >
            <Square className="w-3 h-3 text-rose-400" fill="currentColor" />
          </button>
          {/* Expand button */}
          <button
            onClick={handleExpand}
            className="p-1 rounded hover:bg-slate-700 transition-colors"
            title="Expand to Main Window"
          >
            <Maximize2 className="w-3 h-3 text-slate-400" />
          </button>
          {/* Close button */}
          <button
            onClick={handleClose}
            className="p-1 rounded hover:bg-slate-700 transition-colors"
            title="Close Widget"
          >
            <X className="w-3 h-3 text-slate-400" />
          </button>
        </div>
      </div>

      {/* Time Progress - Compact */}
      <div className="px-2 py-1 border-b border-slate-700/50">
        <div className="flex items-center justify-between text-[10px] mb-0.5">
          {duration > 0 ? (
            <>
              <span className="text-slate-300 font-mono tabular-nums">
                {formatTime(remaining)}
              </span>
              <span className="text-slate-500">
                {formatTime(elapsed)} / {formatTime(duration)}
              </span>
            </>
          ) : (
            <span className="text-slate-300 font-mono tabular-nums">
              ⏱ {formatTime(elapsed)}
            </span>
          )}
        </div>
        {duration > 0 && (
          <div className="h-1 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-1000"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>

      {/* Metrics - Ultra Compact */}
      <div className="grid grid-cols-2 gap-1 px-2 py-1.5">
        <div className="bg-slate-800/50 rounded px-1.5 py-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] text-slate-500 uppercase">CPU</span>
            <span className="text-[9px] text-slate-600">↑{cpuMax.toFixed(0)}%</span>
          </div>
          <div className="text-sm font-bold text-cyan-400 tabular-nums leading-tight">
            {cpuAvg.toFixed(1)}%
          </div>
        </div>
        <div className="bg-slate-800/50 rounded px-1.5 py-1">
          <div className="flex items-baseline justify-between">
            <span className="text-[9px] text-slate-500 uppercase">MEM</span>
            <span className="text-[9px] text-slate-600">↑{memMax.toFixed(0)}</span>
          </div>
          <div className="text-sm font-bold text-violet-400 tabular-nums leading-tight">
            {memAvg.toFixed(0)}MB
          </div>
        </div>
      </div>

      {/* Footer - Sample count */}
      <div className="px-2 pb-1 text-[9px] text-slate-600 text-center">
        {sampleCount} samples
      </div>
    </div>
  );
};
