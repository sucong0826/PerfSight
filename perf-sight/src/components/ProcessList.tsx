import React from 'react';
import { Search, RefreshCw, Play, Square, Layers, Globe, Monitor, Box as BoxIcon } from 'lucide-react';
import { ProcessInfo } from './Charts';

interface ProcessListProps {
  processes: ProcessInfo[];
  selectedPids: Set<number>;
  isCollecting: boolean;
  mode: 'system' | 'browser';
  filterText: string;
  onFilterChange: (val: string) => void;
  onToggleSelection: (pid: number) => void;
  onRefresh: () => void;
  onStart: () => void;
  onStop: () => void;
}

const getProcessIcon = (type: string) => {
  switch(type) {
    case 'GPU': return <Layers className="w-4 h-4 text-amber-400" />;
    case 'Renderer': return <Globe className="w-4 h-4 text-blue-400" />;
    case 'Browser': return <Monitor className="w-4 h-4 text-slate-400" />;
    default: return <BoxIcon className="w-4 h-4 text-slate-600" />;
  }
};

export const ProcessList: React.FC<ProcessListProps> = ({
  processes, selectedPids, isCollecting, mode, 
  filterText, onFilterChange, onToggleSelection, onRefresh, onStart, onStop
}) => {
  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(filterText.toLowerCase()) || 
    (p.title && p.title.toLowerCase().includes(filterText.toLowerCase())) ||
    p.pid.toString().includes(filterText)
  );

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col flex-1 min-h-0 shadow-lg h-full">
        <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-400">
                <Search className="w-4 h-4" /> {mode === 'browser' ? 'Select Tab' : 'Select Process'}
            </h2>
            <button onClick={onRefresh} disabled={isCollecting} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
                <RefreshCw className={`w-3.5 h-3.5 ${isCollecting ? 'animate-spin' : ''}`} />
            </button>
        </div>
        
        <input 
            type="text" 
            placeholder={mode === 'browser' ? "Filter tabs..." : "Filter processes..."}
            className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500 text-slate-200"
            value={filterText}
            onChange={e => onFilterChange(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {filteredProcesses.map(p => {
            const isSelected = selectedPids.has(p.pid);
            return (
            <button 
                key={p.pid}
                onClick={() => onToggleSelection(p.pid)}
                disabled={isCollecting}
                className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-colors ${
                isSelected
                    ? 'bg-indigo-900/40 border border-indigo-500/50 text-indigo-100' 
                    : 'hover:bg-slate-800 text-slate-300 border border-transparent'
                } ${isCollecting ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600'}`}>
                    {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
                </div>
                <div className="shrink-0 opacity-80">{getProcessIcon(p.proc_type)}</div>
                <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                    {p.title || p.name}
                </div>
                <div className="text-xs opacity-60 truncate flex gap-2 items-center">
                    <span>{p.pid}</span>
                    {p.url && <span className="max-w-[200px] truncate" title={p.url}>• {p.url}</span>}
                    {!p.url && p.proc_type !== 'Browser' && <span>• {p.proc_type}</span>}
                </div>
                </div>
            </button>
            )})}
            {filteredProcesses.length === 0 && (
            <div className="text-center text-slate-500 py-4 text-sm">
                {mode === 'browser' ? "No Chrome Tabs found." : "No processes found."}
            </div>
            )}
        </div>

        <div className="mt-4 flex gap-3 pt-3 border-t border-slate-800">
            {!isCollecting ? (
            <button onClick={onStart} disabled={selectedPids.size === 0} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Play className="w-4 h-4" /> Start ({selectedPids.size})</button>
            ) : (
            <button onClick={onStop} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors"><Square className="w-4 h-4" /> Stop</button>
            )}
        </div>
    </div>
  );
};

