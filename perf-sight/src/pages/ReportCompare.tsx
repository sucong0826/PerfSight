import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Loader, GitCompare, AlertTriangle } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush 
} from 'recharts';

interface ReportDetailData {
  id: number;
  title: string;
  created_at: string;
  metrics: Array<{
    timestamp: string;
    metrics: { [pid: string]: any } 
  }>;
}

const COLORS = {
  A: '#6366f1', // Indigo (Baseline)
  B: '#f59e0b', // Amber (Target)
};

export const ReportCompare: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reports, setReports] = useState<ReportDetailData[]>([]);
  const [alignedData, setAlignedData] = useState<any[]>([]);

  useEffect(() => {
    const ids = searchParams.get('ids')?.split(',').map(Number);
    if (!ids || ids.length !== 2) {
      setError("Please select exactly two reports to compare.");
      setLoading(false);
      return;
    }
    loadReports(ids);
  }, [searchParams]);

  const loadReports = async (ids: number[]) => {
    try {
      const results = await Promise.all(ids.map(id => invoke('get_report_detail', { id }))) as ReportDetailData[];
      setReports(results);
      alignData(results[0], results[1]);
      setLoading(false);
    } catch (e: any) {
      setError("Failed to load reports: " + e.toString());
      setLoading(false);
    }
  };

  // Align metrics by relative time (seconds from start)
  const alignData = (reportA: ReportDetailData, reportB: ReportDetailData) => {
    const data: any[] = [];
    
    // Helper to get start time
    // const getStart = (r: ReportDetailData) => r.metrics.length > 0 ? new Date(r.metrics[0].timestamp).getTime() : 0;
    
    // We iterate by max duration
    const maxLen = Math.max(reportA.metrics.length, reportB.metrics.length);
    
    for (let i = 0; i < maxLen; i++) {
        const pointA = reportA.metrics[i];
        const pointB = reportB.metrics[i];
        
        // Calculate relative time (using index approx 1s interval, or timestamp diff for precision)
        // For Phase 1 we assume 1s interval. Ideally use timestamp - start.
        const relativeTime = i; 

        const merged: any = { time: relativeTime };
        
        // Aggregate A (Total CPU/Mem)
        if (pointA) {
            let totalCpu = 0;
            let totalMem = 0;
            let totalHeap = 0;
            Object.values(pointA.metrics).forEach((m: any) => { 
                totalCpu += m.cpu_usage; 
                totalMem += m.memory_rss;
                if (m.js_heap_size) totalHeap += m.js_heap_size;
            });
            merged.cpu_A = totalCpu;
            merged.mem_A = totalMem;
            merged.heap_A = totalHeap;
        }

        // Aggregate B
        if (pointB) {
            let totalCpu = 0;
            let totalMem = 0;
            let totalHeap = 0;
            Object.values(pointB.metrics).forEach((m: any) => { 
                totalCpu += m.cpu_usage; 
                totalMem += m.memory_rss;
                if (m.js_heap_size) totalHeap += m.js_heap_size;
            });
            merged.cpu_B = totalCpu;
            merged.mem_B = totalMem;
            merged.heap_B = totalHeap;
        }

        data.push(merged);
    }
    setAlignedData(data);
  };

  if (loading) return <div className="flex h-full items-center justify-center text-slate-500"><Loader className="animate-spin w-6 h-6 mr-2"/> Comparing...</div>;
  if (error || reports.length < 2) return <div className="p-8 text-rose-400 flex items-center gap-2"><AlertTriangle className="w-5 h-5"/> {error}</div>;

  const [repA, repB] = reports;

  return (
    <div className="p-8 h-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
        <div className="flex items-center gap-4 mb-6 shrink-0">
            <Link to="/reports" className="p-2 hover:bg-slate-900 rounded-lg text-slate-400"><ArrowLeft className="w-5 h-5"/></Link>
            <h1 className="text-xl font-bold flex items-center gap-2"><GitCompare className="w-5 h-5"/> Comparison</h1>
        </div>

        {/* Legend Header */}
        <div className="grid grid-cols-2 gap-6 mb-6 shrink-0">
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl border-l-4" style={{ borderLeftColor: COLORS.A }}>
                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Baseline (A)</div>
                <div className="font-medium truncate">{repA.title}</div>
                <div className="text-sm text-slate-500">{new Date(repA.created_at).toLocaleString()}</div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl border-l-4" style={{ borderLeftColor: COLORS.B }}>
                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Target (B)</div>
                <div className="font-medium truncate">{repB.title}</div>
                <div className="text-sm text-slate-500">{new Date(repB.created_at).toLocaleString()}</div>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-6">
            {/* CPU Compare */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[350px] shadow-xl">
                <h3 className="text-slate-400 font-medium mb-4">Total CPU Comparison</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" label={{ value: 'Seconds (T+)', position: 'insideBottomRight', offset: -5 }} stroke="#475569" fontSize={10} />
                        <YAxis stroke="#475569" fontSize={12} label={{ value: '%', position: 'insideLeft', angle: -90 }} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                            labelFormatter={(label) => `T+${label}s`}
                            formatter={(val: number) => [val.toFixed(1) + '%']}
                        />
                        <Legend />
                        <Line name={`Baseline: ${repA.title}`} type="monotone" dataKey="cpu_A" stroke={COLORS.A} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line name={`Target: ${repB.title}`} type="monotone" dataKey="cpu_B" stroke={COLORS.B} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Brush dataKey="time" height={30} stroke="#475569" fill="#1e293b" />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Memory Compare */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[350px] shadow-xl">
                <h3 className="text-slate-400 font-medium mb-4">Total Memory Comparison</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" label={{ value: 'Seconds (T+)', position: 'insideBottomRight', offset: -5 }} stroke="#475569" fontSize={10} />
                        <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => (val/1024/1024).toFixed(0)} label={{ value: 'MB', position: 'insideLeft', angle: -90 }} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                            labelFormatter={(label) => `T+${label}s`}
                            formatter={(val: number) => [(val/1024/1024).toFixed(1) + ' MB']}
                        />
                        <Legend />
                        <Line name={`Baseline: ${repA.title}`} type="monotone" dataKey="mem_A" stroke={COLORS.A} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line name={`Target: ${repB.title}`} type="monotone" dataKey="mem_B" stroke={COLORS.B} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Brush dataKey="time" height={30} stroke="#475569" fill="#1e293b" />
                    </LineChart>
                </ResponsiveContainer>
            </div>

            {/* Heap Compare (Only if data exists) */}
            {alignedData.some(d => (d.heap_A > 0 || d.heap_B > 0)) && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[350px] shadow-xl">
                <h3 className="text-slate-400 font-medium mb-4">Total JS Heap Comparison</h3>
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" label={{ value: 'Seconds (T+)', position: 'insideBottomRight', offset: -5 }} stroke="#475569" fontSize={10} />
                        <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => (val/1024/1024).toFixed(0)} label={{ value: 'MB', position: 'insideLeft', angle: -90 }} />
                        <Tooltip 
                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                            labelFormatter={(label) => `T+${label}s`}
                            formatter={(val: number) => [(val/1024/1024).toFixed(1) + ' MB']}
                        />
                        <Legend />
                        <Line name={`Baseline: ${repA.title}`} type="monotone" dataKey="heap_A" stroke={COLORS.A} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Line name={`Target: ${repB.title}`} type="monotone" dataKey="heap_B" stroke={COLORS.B} strokeWidth={2} dot={false} isAnimationActive={false} />
                        <Brush dataKey="time" height={30} stroke="#475569" fill="#1e293b" />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            )}
        </div>
    </div>
  );
};

