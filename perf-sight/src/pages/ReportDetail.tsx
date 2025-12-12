import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { ArrowLeft, Loader, AlertTriangle, CheckCircle, TrendingUp, Download } from 'lucide-react';
import { PerformanceCharts, ProcessInfo } from '../components/Charts';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface AnalysisReport {
  score: number;
  summary: {
    avg_cpu: number;
    max_cpu: number;
    p95_cpu: number;
    avg_mem_mb: number;
    max_mem_mb: number;
    mem_growth_rate: number;
  };
  insights: string[];
}

interface ReportDetailData {
  id: number;
  title: string;
  metrics: Array<{
    timestamp: string;
    metrics: { [pid: string]: any } // Rust BatchMetric struct
  }>;
  analysis?: AnalysisReport;
}

export const ReportDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [report, setReport] = useState<ReportDetailData | null>(null);
  const [chartData, setChartData] = useState<any[]>([]);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [hiddenPids, setHiddenPids] = useState<Set<number>>(new Set());
  const [detectedMode, setDetectedMode] = useState<'system' | 'browser'>('system');

  useEffect(() => {
    if (!id) return;
    invoke('get_report_detail', { id: parseInt(id) }).then((data: any) => {
      setReport(data);
      processData(data);
    }).catch(console.error);
  }, [id]);

  const processData = (data: ReportDetailData) => {
    const flattenedData: any[] = [];
    const foundPids = new Set<number>();
    
    // Flatten metrics for charts
    data.metrics.forEach(batch => {
        const point: any = { timestamp: batch.timestamp };
        Object.entries(batch.metrics).forEach(([pidStr, metric]: [string, any]) => {
            const pid = parseInt(pidStr);
            foundPids.add(pid);
            point[`cpu_${pid}`] = metric.cpu_usage;
            point[`rss_${pid}`] = metric.memory_rss;
            if (metric.js_heap_size) point[`heap_${pid}`] = metric.js_heap_size;
            if (metric.gpu_usage) point[`gpu_${pid}`] = metric.gpu_usage;
        });
        flattenedData.push(point);
    });
    setChartData(flattenedData);

    // Detect mode based on data
    const hasHeap = flattenedData.some(d => Object.keys(d).some(k => k.startsWith('heap_')));
    setDetectedMode(hasHeap ? 'browser' : 'system');

    // Mock process info for now since we don't store full metadata in Phase 1
    // Ideally, we should store process names in the report too.
    const procList: ProcessInfo[] = Array.from(foundPids).map(pid => ({
        pid,
        name: `Process ${pid}`, // Fallback
        proc_type: 'Unknown',
        cpu_usage: 0,
        memory_usage: 0
    }));
    setProcesses(procList);
  };

  if (!report) return <div className="flex h-screen items-center justify-center text-slate-500"><Loader className="animate-spin w-6 h-6 mr-2"/> Loading...</div>;

  const getScoreColor = (score: number) => {
    if (score >= 90) return 'text-emerald-400';
    if (score >= 70) return 'text-amber-400';
    return 'text-rose-400';
  };

  const handleExport = async () => {
    const element = document.getElementById('report-content');
    if (!element || !report) return;
    
    try {
        const canvas = await html2canvas(element, {
            scale: 2, 
            backgroundColor: '#020617', // slate-950
            logging: false,
            useCORS: true
        });
        
        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pdfWidth = pdf.internal.pageSize.getWidth();
        
        const imgProps = pdf.getImageProperties(imgData);
        const pdfImgHeight = (imgProps.height * (pdfWidth - 20)) / imgProps.width;
        
        // If height > page height, we might need multiple pages.
        // For MVP, we just add the image. If it's too long, it might be cut off or scaled.
        // Better: Split if needed, but 'PerformanceCharts' is hard to split.
        // We'll stick to single page fitting or scrolling capture.
        
        pdf.addImage(imgData, 'PNG', 10, 10, pdfWidth - 20, pdfImgHeight);
        pdf.save(`PerfSight_Report_${report.id}.pdf`);
    } catch (err) {
        console.error("Export failed", err);
        alert("Failed to export PDF");
    }
  };

  return (
    <div className="p-8 h-screen flex flex-col bg-slate-950 text-slate-200 overflow-hidden">
        <div className="flex items-center justify-between mb-6 shrink-0">
            <div className="flex items-center gap-4">
                <Link to="/reports" className="p-2 hover:bg-slate-900 rounded-lg text-slate-400"><ArrowLeft className="w-5 h-5"/></Link>
                <h1 className="text-xl font-bold">{report.title}</h1>
            </div>
            <button 
                onClick={handleExport}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg font-medium transition-colors"
            >
                <Download className="w-4 h-4" /> Export PDF
            </button>
        </div>
        
        <div id="report-content" className="flex-1 overflow-y-auto p-4"> // Added ID and padding for capture
            {report.analysis && (
            <div className="mb-6 grid grid-cols-1 lg:grid-cols-4 gap-4">
                {/* Score Card */}
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl flex flex-col items-center justify-center relative overflow-hidden">
                    <div className="text-sm text-slate-500 uppercase font-bold mb-2">Performance Score</div>
                    <div className={`text-5xl font-bold ${getScoreColor(report.analysis.score)}`}>{report.analysis.score}</div>
                    <div className="absolute top-0 right-0 p-2 opacity-10">
                         {report.analysis.score >= 80 ? <CheckCircle className="w-24 h-24" /> : <AlertTriangle className="w-24 h-24" />}
                    </div>
                </div>

                {/* Stats */}
                <div className="lg:col-span-2 bg-slate-900 border border-slate-800 p-5 rounded-xl grid grid-cols-2 gap-4">
                     <div>
                        <div className="text-xs text-slate-500 mb-1">Avg CPU</div>
                        <div className="text-xl font-medium">{report.analysis.summary.avg_cpu.toFixed(1)}%</div>
                     </div>
                     <div>
                        <div className="text-xs text-slate-500 mb-1">Max CPU</div>
                        <div className="text-xl font-medium">{report.analysis.summary.max_cpu.toFixed(1)}%</div>
                     </div>
                     <div>
                        <div className="text-xs text-slate-500 mb-1">Avg Memory</div>
                        <div className="text-xl font-medium">{report.analysis.summary.avg_mem_mb.toFixed(0)} MB</div>
                     </div>
                     <div>
                        <div className="text-xs text-slate-500 mb-1">Mem Growth</div>
                        <div className={`text-xl font-medium flex items-center gap-2 ${report.analysis.summary.mem_growth_rate > 0.1 ? 'text-rose-400' : 'text-slate-200'}`}>
                            {report.analysis.summary.mem_growth_rate.toFixed(2)} MB/s
                            {report.analysis.summary.mem_growth_rate > 0.1 && <TrendingUp className="w-4 h-4" />}
                        </div>
                     </div>
                </div>

                {/* Insights */}
                <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl overflow-y-auto max-h-[160px] custom-scrollbar">
                    <div className="text-sm text-slate-500 uppercase font-bold mb-3">Insights</div>
                    {report.analysis.insights.length === 0 ? (
                        <div className="text-sm text-slate-500 italic">No issues detected. Good job!</div>
                    ) : (
                        <ul className="space-y-2">
                            {report.analysis.insights.map((insight, i) => (
                                <li key={i} className="text-sm text-rose-300 flex gap-2 items-start">
                                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                    <span>{insight}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            )}

            <PerformanceCharts 
                data={chartData} 
                selectedProcesses={processes} 
                hiddenPids={hiddenPids} 
                onToggleVisibility={(pid) => {
                    const next = new Set(hiddenPids);
                    if (next.has(pid)) next.delete(pid);
                    else next.add(pid);
                    setHiddenPids(next);
                }}
                mode={detectedMode}
            />
        </div>
    </div>
  );
};

