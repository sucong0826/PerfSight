import React from 'react';
import { Search, RefreshCw, Play, Square, Layers, Globe, Monitor, Box as BoxIcon } from 'lucide-react';
import { ProcessInfo } from './Charts';

interface ProcessListProps {
  processes: ProcessInfo[];
  selectedPids: Set<number>;
  processAliases?: Record<number, string>;
  onRenameProcess?: (pid: number, alias: string) => void;
  isCollecting: boolean;
  mode: 'system' | 'browser';
  filterText: string;
  durationMinutesText: string;
  onDurationMinutesTextChange: (val: string) => void;
  durationHint?: string | null;
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
  processAliases,
  onRenameProcess,
  filterText,
  durationMinutesText,
  onDurationMinutesTextChange,
  durationHint,
  onFilterChange,
  onToggleSelection,
  onRefresh,
  onStart,
  onStop
}) => {
  const getAlias = (pid: number) => {
    const raw = (processAliases && (processAliases as any)[pid]) || "";
    return typeof raw === "string" ? raw : "";
  };

  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(filterText.toLowerCase()) || 
    (p.title && p.title.toLowerCase().includes(filterText.toLowerCase())) ||
    getAlias(p.pid).toLowerCase().includes(filterText.toLowerCase()) ||
    p.pid.toString().includes(filterText)
  );

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col flex-1 min-h-0 shadow-lg h-full dark:bg-slate-900/50 dark:border-slate-800">
        <div className="flex justify-between items-center mb-3">
            <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-600 dark:text-slate-400">
                <Search className="w-4 h-4" /> Select Process
            </h2>
            <button onClick={onRefresh} disabled={isCollecting} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500 dark:text-slate-400">
                <RefreshCw className={`w-3.5 h-3.5 ${isCollecting ? 'animate-spin' : ''}`} />
            </button>
        </div>
        
        <input 
            type="text" 
            placeholder={mode === 'browser' ? "Filter tabs..." : "Filter processes..."}
            className="bg-white border border-slate-200 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500 text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
            value={filterText}
            onChange={e => onFilterChange(e.target.value)}
        />

        <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
            {filteredProcesses.map(p => {
            const isSelected = selectedPids.has(p.pid);
            return (
            <div
              key={p.pid}
              className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-start gap-3 transition-colors ${
              isSelected
                  ? 'bg-indigo-600/10 border border-indigo-500/30 text-indigo-700 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-100' 
                  : 'hover:bg-slate-100 text-slate-700 border border-transparent dark:hover:bg-slate-800 dark:text-slate-300'
              } ${isCollecting ? 'opacity-50 cursor-not-allowed' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onToggleSelection(p.pid)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onToggleSelection(p.pid);
              }}
            >
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 dark:bg-indigo-500 dark:border-indigo-500' : 'border-slate-400 dark:border-slate-600'}`}>
                    {isSelected && <div className="w-2 h-2 bg-white rounded-sm" />}
                </div>
                <div className="shrink-0 opacity-80">{getProcessIcon(p.proc_type)}</div>
                <div className="min-w-0 flex-1">
                <div className="font-medium truncate">
                    {(getAlias(p.pid).trim() ? getAlias(p.pid).trim() : (p.title || p.name))}
                </div>
                <div className="text-xs opacity-60 truncate flex gap-2 items-center">
                    <span>{p.pid}</span>
                    {p.url && <span className="max-w-[200px] truncate" title={p.url}>• {p.url}</span>}
                    {!p.url && p.proc_type !== 'Browser' && <span>• {p.proc_type}</span>}
                </div>
                {isSelected && onRenameProcess ? (
                  <div className="mt-2">
                    <div className="text-[11px] text-slate-500 mb-1 dark:text-slate-500">Rename (optional)</div>
                    <input
                      value={getAlias(p.pid)}
                      onChange={(e) => onRenameProcess(p.pid, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                      disabled={isCollecting}
                      placeholder="e.g. Main Tab / Game Client / GPU"
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                    />
                  </div>
                ) : null}
                </div>
            </div>
            )})}
            {filteredProcesses.length === 0 && (
            <div className="text-center text-slate-500 py-4 text-sm">
                {mode === 'browser' ? "No Chrome Tabs found." : "No processes found."}
            </div>
            )}
        </div>

        <div className="mt-4 flex gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            {!isCollecting ? (
            <div className="flex-1 space-y-2">
              <div>
                <div className="text-xs text-slate-500 mb-1">Duration (minutes, optional)</div>
                <input
                  value={durationMinutesText}
                  onChange={(e) => onDurationMinutesTextChange(e.target.value)}
                  disabled={isCollecting}
                  inputMode="decimal"
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 disabled:opacity-60 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="e.g. 2 (auto-stop)"
                />
                {durationHint ? (
                  <div className="mt-1 text-[11px] text-slate-500">{durationHint}</div>
                ) : null}
              </div>
              <button onClick={onStart} disabled={selectedPids.size === 0} className="w-full bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"><Play className="w-4 h-4" /> Start ({selectedPids.size})</button>
            </div>
            ) : (
            <button onClick={onStop} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors"><Square className="w-4 h-4" /> Stop</button>
            )}
        </div>
    </div>
  );
};

