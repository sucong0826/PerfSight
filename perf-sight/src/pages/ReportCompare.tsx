import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Loader, GitCompare, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush 
} from 'recharts';

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
                totalMem += (m.memory_private ?? m.memory_rss) ?? 0;
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
                totalMem += (m.memory_private ?? m.memory_rss) ?? 0;
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

  const fmtPct = (v?: number) => (typeof v === "number" ? `${v.toFixed(1)}%` : "—");
  const fmtMb = (v?: number) => (typeof v === "number" ? `${v.toFixed(0)} MB` : "—");
  const fmtRatio = (v?: number) => (typeof v === "number" ? `${(v * 100).toFixed(0)}%` : "—");
  const deltaBadge = (delta: number, worseWhenHigher = true) => {
    const worse = worseWhenHigher ? delta > 0 : delta < 0;
    const cls = worse ? "text-rose-300 bg-rose-500/10 border-rose-500/30" : "text-emerald-300 bg-emerald-500/10 border-emerald-500/30";
    const Icon = worse ? TrendingUp : TrendingDown;
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-xs ${cls}`}>
        <Icon className="w-3.5 h-3.5" />
        {delta > 0 ? "+" : ""}{delta.toFixed(1)}
      </span>
    );
  };

  const a = repA.analysis?.summary;
  const b = repB.analysis?.summary;

  const cpuAvgDelta = (b?.avg_cpu ?? 0) - (a?.avg_cpu ?? 0);
  const cpuP95Delta = (b?.p95_cpu ?? 0) - (a?.p95_cpu ?? 0);
  const memAvgDelta = (b?.avg_mem_mb ?? 0) - (a?.avg_mem_mb ?? 0);
  const memGrowthDelta = (b?.mem_growth_rate ?? 0) - (a?.mem_growth_rate ?? 0);

  return (
    <div className="p-8 h-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
        <div className="flex items-center gap-4 mb-6 shrink-0">
            <Link to="/reports" className="p-2 hover:bg-slate-900 rounded-lg text-slate-400"><ArrowLeft className="w-5 h-5"/></Link>
            <h1 className="text-xl font-bold flex items-center gap-2"><GitCompare className="w-5 h-5"/> Comparison</h1>
        </div>

        {/* Run Context Header */}
        <div className="grid grid-cols-2 gap-6 mb-6 shrink-0">
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl border-l-4" style={{ borderLeftColor: COLORS.A }}>
                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Baseline (A)</div>
                <div className="font-medium truncate">{repA.title}</div>
                <div className="text-sm text-slate-500">{new Date(repA.created_at).toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-2">
                  mode: {repA.meta?.collection?.mode ?? "—"} · interval: {repA.meta?.collection?.interval_ms ?? "—"}ms · duration: {repA.meta?.collection?.duration_seconds ?? "—"}s
                </div>
                <div className="text-xs text-slate-500">
                  build: {repA.meta?.test_context?.build_id ?? "—"} · tags: {(repA.meta?.test_context?.tags ?? []).join(", ") || "—"}
                </div>
            </div>
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl border-l-4" style={{ borderLeftColor: COLORS.B }}>
                <div className="text-xs text-slate-500 uppercase font-bold mb-1">Target (B)</div>
                <div className="font-medium truncate">{repB.title}</div>
                <div className="text-sm text-slate-500">{new Date(repB.created_at).toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-2">
                  mode: {repB.meta?.collection?.mode ?? "—"} · interval: {repB.meta?.collection?.interval_ms ?? "—"}ms · duration: {repB.meta?.collection?.duration_seconds ?? "—"}s
                </div>
                <div className="text-xs text-slate-500">
                  build: {repB.meta?.test_context?.build_id ?? "—"} · tags: {(repB.meta?.test_context?.tags ?? []).join(", ") || "—"}
                </div>
            </div>
        </div>

        {/* Executive Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 mb-6 shrink-0">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">Avg CPU (B - A)</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {typeof a?.avg_cpu === "number" && typeof b?.avg_cpu === "number" ? deltaBadge(cpuAvgDelta, true) : "—"}
              <span className="text-slate-400 text-sm">({fmtPct(a?.avg_cpu)} → {fmtPct(b?.avg_cpu)})</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">P95 CPU (B - A)</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {typeof a?.p95_cpu === "number" && typeof b?.p95_cpu === "number" ? deltaBadge(cpuP95Delta, true) : "—"}
              <span className="text-slate-400 text-sm">({fmtPct(a?.p95_cpu)} → {fmtPct(b?.p95_cpu)})</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">Avg Memory (B - A)</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {typeof a?.avg_mem_mb === "number" && typeof b?.avg_mem_mb === "number" ? deltaBadge(memAvgDelta, true) : "—"}
              <span className="text-slate-400 text-sm">({fmtMb(a?.avg_mem_mb)} → {fmtMb(b?.avg_mem_mb)})</span>
            </div>
          </div>
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-xs text-slate-500 mb-1">Mem Growth (B - A)</div>
            <div className="text-lg font-semibold flex items-center gap-2">
              {typeof a?.mem_growth_rate === "number" && typeof b?.mem_growth_rate === "number" ? deltaBadge(memGrowthDelta, true) : "—"}
              <span className="text-slate-400 text-sm">({(a?.mem_growth_rate ?? 0).toFixed(2)} → {(b?.mem_growth_rate ?? 0).toFixed(2)} MB/s)</span>
            </div>
          </div>
        </div>

        {/* Key Metrics Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-6 shrink-0">
          <div className="text-slate-400 font-medium mb-3">Key Metrics (from report analysis)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-500 text-xs border-b border-slate-800">
                  <th className="text-left py-2 pr-3">Metric</th>
                  <th className="text-right py-2 px-3">Baseline (A)</th>
                  <th className="text-right py-2 px-3">Target (B)</th>
                  <th className="text-right py-2 pl-3">Δ (B-A)</th>
                </tr>
              </thead>
              <tbody className="text-slate-200">
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">CPU avg</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(a?.avg_cpu)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(b?.avg_cpu)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{typeof a?.avg_cpu === "number" && typeof b?.avg_cpu === "number" ? cpuAvgDelta.toFixed(1) : "—"}</td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">CPU p95</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(a?.p95_cpu)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(b?.p95_cpu)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{typeof a?.p95_cpu === "number" && typeof b?.p95_cpu === "number" ? cpuP95Delta.toFixed(1) : "—"}</td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">CPU p99</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(a?.p99_cpu)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtPct(b?.p99_cpu)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{typeof a?.p99_cpu === "number" && typeof b?.p99_cpu === "number" ? ((b!.p99_cpu! - a!.p99_cpu!).toFixed(1)) : "—"}</td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">CPU &gt; 60% ratio</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtRatio(a?.cpu_high_ratio_60)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtRatio(b?.cpu_high_ratio_60)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {typeof a?.cpu_high_ratio_60 === "number" && typeof b?.cpu_high_ratio_60 === "number"
                      ? `${((b.cpu_high_ratio_60 - a.cpu_high_ratio_60) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">Memory avg</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtMb(a?.avg_mem_mb)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtMb(b?.avg_mem_mb)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{typeof a?.avg_mem_mb === "number" && typeof b?.avg_mem_mb === "number" ? memAvgDelta.toFixed(0) : "—"}</td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">Memory p95</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtMb(a?.p95_mem_mb)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtMb(b?.p95_mem_mb)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {typeof a?.p95_mem_mb === "number" && typeof b?.p95_mem_mb === "number"
                      ? (b.p95_mem_mb - a.p95_mem_mb).toFixed(0)
                      : "—"}
                  </td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="py-2 pr-3">Memory &gt; 1GB ratio</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtRatio(a?.mem_high_ratio_1024mb)}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{fmtRatio(b?.mem_high_ratio_1024mb)}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">
                    {typeof a?.mem_high_ratio_1024mb === "number" && typeof b?.mem_high_ratio_1024mb === "number"
                      ? `${((b.mem_high_ratio_1024mb - a.mem_high_ratio_1024mb) * 100).toFixed(0)}%`
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td className="py-2 pr-3">Memory growth (MB/s)</td>
                  <td className="py-2 px-3 text-right tabular-nums">{typeof a?.mem_growth_rate === "number" ? a.mem_growth_rate.toFixed(2) : "—"}</td>
                  <td className="py-2 px-3 text-right tabular-nums">{typeof b?.mem_growth_rate === "number" ? b.mem_growth_rate.toFixed(2) : "—"}</td>
                  <td className="py-2 pl-3 text-right tabular-nums">{typeof a?.mem_growth_rate === "number" && typeof b?.mem_growth_rate === "number" ? memGrowthDelta.toFixed(2) : "—"}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-6">
            {/* CPU Compare */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[370px] shadow-xl flex flex-col">
                <h3 className="text-slate-400 font-medium mb-4">Total CPU Comparison</h3>
                <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#475569" fontSize={10} />
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
                <div className="mt-2 text-xs text-slate-500 flex justify-end">Seconds (T+)</div>
            </div>

            {/* Memory Compare */}
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[370px] shadow-xl flex flex-col">
                <h3 className="text-slate-400 font-medium mb-4">Total Memory Comparison</h3>
                <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#475569" fontSize={10} />
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
                <div className="mt-2 text-xs text-slate-500 flex justify-end">Seconds (T+)</div>
            </div>

            {/* Heap Compare (Only if data exists) */}
            {alignedData.some(d => (d.heap_A > 0 || d.heap_B > 0)) && (
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[370px] shadow-xl flex flex-col">
                <h3 className="text-slate-400 font-medium mb-4">Total JS Heap Comparison</h3>
                <div className="flex-1 min-h-0">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={alignedData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                        <XAxis dataKey="time" stroke="#475569" fontSize={10} />
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
                <div className="mt-2 text-xs text-slate-500 flex justify-end">Seconds (T+)</div>
            </div>
            )}
        </div>
    </div>
  );
};

