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
  memory_rss: number;
  js_heap_size?: number;
  gpu_usage?: number;
}

interface BatchMetric {
  timestamp: string;
  metrics: { [pid: number]: MetricPoint };
}

export const Dashboard: React.FC = () => {
  const [mode, setMode] = useState<'system' | 'browser'>('system');
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  
  const [selectedPids, setSelectedPids] = useState<Set<number>>(new Set());
  const [hiddenPids, setHiddenPids] = useState<Set<number>>(new Set());
  
  const [isCollecting, setIsCollecting] = useState(false);
  const [chartData, setChartData] = useState<any[]>([]); 
  const [filterText, setFilterText] = useState('');
  
  const maxDataPoints = 3600;
  const mockTimerRef = useRef<any>(null);

  useEffect(() => {
    loadProcesses();
    if (!isCollecting) {
        setSelectedPids(new Set());
        setHiddenPids(new Set());
    }
  }, [mode]);

  const loadProcesses = async () => {
    try {
      const list = await invoke('get_process_list', { mode }) as ProcessInfo[];
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
          { pid: 1001, name: 'chrome.exe', proc_type: 'Browser', title: 'Mock Main', cpu_usage: 1.2, memory_usage: 1024*1024*100 },
          { pid: 1002, name: 'chrome.exe', proc_type: 'Renderer', title: 'Mock Tab', cpu_usage: 5.5, memory_usage: 1024*1024*300 },
      ]);
    }
  };

  const handleStart = async () => {
    if (selectedPids.size === 0) return;
    try {
      const pids = Array.from(selectedPids);
      await invoke('start_collection', { 
        config: { target_pids: pids, interval_ms: 1000, mode: mode } 
      });
      setIsCollecting(true);
      setChartData([]);
      
      try {
        await listen('new-metric-batch', (event: any) => {
           const batch = event.payload as BatchMetric;
           addBatchMetric(batch);
        });
      } catch (err) {
          startMockDataGeneration(pids);
      }
    } catch (e: any) {
      console.error(e);
      startMockDataGeneration(Array.from(selectedPids));
    }
  };

  const handleStop = async () => {
    try {
      await invoke('stop_collection');
      setIsCollecting(false);
      if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    } catch (e) {
      console.error(e);
    }
  };

  const addBatchMetric = (batch: BatchMetric) => {
    setChartData(prev => {
      const point: any = { timestamp: batch.timestamp };
      Object.entries(batch.metrics).forEach(([pidStr, metric]) => {
          point[`cpu_${pidStr}`] = metric.cpu_usage;
          point[`rss_${pidStr}`] = metric.memory_rss;
          if (metric.js_heap_size) point[`heap_${pidStr}`] = metric.js_heap_size;
          if (metric.gpu_usage) point[`gpu_${pidStr}`] = metric.gpu_usage;
      });
      const newData = [...prev, point];
      if (newData.length > maxDataPoints) return newData.slice(newData.length - maxDataPoints);
      return newData;
    });
  };

  const startMockDataGeneration = (pids: number[]) => {
    if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    mockTimerRef.current = setInterval(() => {
       const now = new Date().toISOString();
       const metricsMock: {[key:number]: MetricPoint} = {};
       pids.forEach(pid => {
           metricsMock[pid] = {
            timestamp: now,
            pid: pid,
            cpu_usage: Math.random() * 30,
            memory_rss: 1024 * 1024 * (200 + Math.random() * 50),
          } as any;
       });
       addBatchMetric({ timestamp: now, metrics: metricsMock });
    }, 1000);
  };

  const selectedProcessList = processes.filter(p => selectedPids.has(p.pid));

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-200">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-indigo-500" />
          <h1 className="text-xl font-bold">PerfSight</h1>
          <div className="h-6 w-px bg-slate-700 mx-2"></div>
          
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button 
                onClick={() => !isCollecting && setMode('system')} 
                disabled={isCollecting}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'system' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'} ${isCollecting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                System API
            </button>
            <button 
                onClick={() => !isCollecting && setMode('browser')}
                disabled={isCollecting}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${mode === 'browser' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'} ${isCollecting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                Browser API
            </button>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium ${isCollecting ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
          {isCollecting ? 'Collecting' : 'Idle'}
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
            />
        </div>
      </main>
    </div>
  );
};

