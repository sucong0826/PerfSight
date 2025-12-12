import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Calendar, Clock, ChevronRight, GitCompare, CheckSquare, Square } from 'lucide-react';

interface ReportSummary {
  id: number;
  created_at: string;
  title: string;
}

export const Reports: React.FC = () => {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const navigate = useNavigate();

  useEffect(() => {
    invoke('get_reports').then((data: any) => setReports(data)).catch(console.error);
  }, []);

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.preventDefault(); // Prevent link navigation
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else if (next.size < 2) next.add(id); // Limit to 2 for now
    setSelectedIds(next);
  };

  const handleCompare = () => {
    if (selectedIds.size !== 2) return;
    const ids = Array.from(selectedIds).join(',');
    navigate(`/compare?ids=${ids}`);
  };

  return (
    <div className="p-8 max-w-5xl mx-auto text-slate-200 relative">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileText className="w-6 h-6 text-indigo-500" /> Test Reports
        </h1>
        
        {selectedIds.size > 0 && (
            <div className="flex items-center gap-4 bg-slate-900 border border-indigo-500/30 px-4 py-2 rounded-lg animate-in fade-in slide-in-from-bottom-2">
                <span className="text-sm text-slate-300">{selectedIds.size} selected</span>
                <button 
                    onClick={handleCompare}
                    disabled={selectedIds.size !== 2}
                    className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                >
                    <GitCompare className="w-4 h-4" /> Compare
                </button>
                <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-500 hover:text-slate-300">Clear</button>
            </div>
        )}
      </div>
      
      <div className="space-y-3">
        {reports.map(report => {
          const isSelected = selectedIds.has(report.id);
          return (
          <Link key={report.id} to={`/report/${report.id}`} className={`block bg-slate-900 border rounded-lg p-4 transition-colors flex items-center justify-between group ${isSelected ? 'border-indigo-500 bg-indigo-900/10' : 'border-slate-800 hover:border-indigo-500/50'}`}>
            <div className="flex items-center gap-4">
                <button onClick={(e) => toggleSelect(report.id, e)} className="text-slate-500 hover:text-indigo-400 transition-colors">
                    {isSelected ? <CheckSquare className="w-5 h-5 text-indigo-500" /> : <Square className="w-5 h-5" />}
                </button>
                <div>
                    <div className="font-medium text-lg">{report.title}</div>
                    <div className="text-sm text-slate-500 flex gap-4 mt-1">
                        <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" /> {new Date(report.created_at).toLocaleDateString()}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {new Date(report.created_at).toLocaleTimeString()}</span>
                    </div>
                </div>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-indigo-400" />
          </Link>
        )})}
        {reports.length === 0 && (
            <div className="text-center text-slate-500 py-10">No reports found. Run a test to generate one.</div>
        )}
      </div>
    </div>
  );
};

