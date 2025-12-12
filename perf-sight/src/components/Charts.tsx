import React, { useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Brush 
} from 'recharts';
import { LayoutGrid, Rows, Cpu, Database } from 'lucide-react';

export interface ProcessInfo {
  pid: number;
  name: string;
  memory_usage: number;
  cpu_usage: number;
  proc_type: string;
  title?: string;
  url?: string;
}

interface ChartsProps {
  data: any[];
  selectedProcesses: ProcessInfo[];
  hiddenPids: Set<number>;
  onToggleVisibility: (pid: number) => void;
  mode: 'system' | 'browser';
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

const getColor = (index: number) => {
  const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#d946ef'];
  return colors[index % colors.length];
};

export const PerformanceCharts: React.FC<ChartsProps> = ({ 
  data, selectedProcesses, hiddenPids, onToggleVisibility, mode 
}) => {
  const [viewMode, setViewMode] = useState<'combined' | 'split'>('combined');

  return (
    <div className="space-y-6">
      {/* Chart 1: CPU */}
      <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl ${viewMode === 'split' ? 'h-auto' : 'h-[300px]'}`}>
        <div className="flex justify-between items-center mb-4">
           <h3 className="text-slate-400 font-medium flex items-center gap-2"><Cpu className="w-4 h-4" /> CPU Load (System Level)</h3>
           <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
              <button onClick={() => setViewMode('combined')} className={`p-1.5 rounded ${viewMode === 'combined' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Combined View"><LayoutGrid className="w-4 h-4" /></button>
              <button onClick={() => setViewMode('split')} className={`p-1.5 rounded ${viewMode === 'split' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-slate-200'}`} title="Split View"><Rows className="w-4 h-4" /></button>
           </div>
        </div>
        
        {viewMode === 'combined' ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                    minTickGap={50}
                    stroke="#475569"
                    fontSize={10}
                  />
                  <YAxis stroke="#475569" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                    formatter={(val: number) => [val.toFixed(1) + '%', '']}
                  />
                  <Legend 
                    onClick={(e) => {
                        const dataKey = e.dataKey as string;
                        if (dataKey) {
                            const parts = dataKey.split('_');
                            if (parts.length === 2) {
                                const pid = parseInt(parts[1], 10);
                                if (!isNaN(pid)) onToggleVisibility(pid);
                            }
                        }
                    }} 
                    wrapperStyle={{ cursor: 'pointer' }} 
                  />
                  {selectedProcesses.map((p, idx) => (
                      <Line 
                        key={`cpu_${p.pid}`}
                        hide={hiddenPids.has(p.pid)}
                        name={`${p.name} (${p.pid})`}
                        type="monotone" 
                        dataKey={`cpu_${p.pid}`} 
                        stroke={getColor(idx)} 
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false} 
                      />
                  ))}
                  <Brush dataKey="timestamp" height={30} stroke="#4f46e5" fill="#1e293b" tickFormatter={() => ''} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        ) : (
            <div className="space-y-4">
                {selectedProcesses.filter(p => !hiddenPids.has(p.pid)).map((p, idx) => (
                    <div key={`cpu_split_${p.pid}`} className="h-[150px] border-b border-slate-800/50 pb-2">
                         <div className="text-xs text-slate-500 mb-1 flex justify-between">
                             <span>{p.name} ({p.pid})</span>
                             <span style={{ color: getColor(idx) }}>CPU</span>
                         </div>
                         <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="timestamp" hide />
                              <YAxis stroke="#475569" fontSize={10} width={30} />
                              <Tooltip formatter={(val: number) => [val.toFixed(1) + '%', '']} labelStyle={{ display: 'none' }} />
                              <Line type="monotone" dataKey={`cpu_${p.pid}`} stroke={getColor(idx)} strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ))}
            </div>
        )}
      </div>

      {/* Chart 2: Memory */}
      <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl ${viewMode === 'split' ? 'h-auto' : 'h-[300px]'}`}>
        <h3 className="text-slate-400 font-medium mb-4 flex items-center gap-2">
          <Database className="w-4 h-4" /> Memory Usage {mode === 'browser' ? '(RSS vs JS Heap)' : '(RSS)'}
        </h3>
        
        {viewMode === 'combined' ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="timestamp" tickFormatter={(time) => new Date(time).toLocaleTimeString()} minTickGap={50} stroke="#475569" fontSize={10} />
                  <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => (val/1024/1024).toFixed(0)} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                    formatter={(val:number) => [formatBytes(val), '']}
                  />
                  <Legend 
                    onClick={(e) => {
                        const dataKey = e.dataKey as string;
                        if (dataKey) {
                            const parts = dataKey.split('_');
                            if (parts.length === 2) {
                                const pid = parseInt(parts[1], 10);
                                if (!isNaN(pid)) onToggleVisibility(pid);
                            }
                        }
                    }} 
                    wrapperStyle={{ cursor: 'pointer' }} 
                  />
                  {selectedProcesses.map((p, idx) => (
                      <Line 
                        key={`rss_${p.pid}`}
                        hide={hiddenPids.has(p.pid)}
                        name={`RSS ${p.pid}`}
                        type="monotone" 
                        dataKey={`rss_${p.pid}`} 
                        stroke={getColor(idx)} 
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false} 
                      />
                  ))}
                  <Brush dataKey="timestamp" height={30} stroke="#34d399" fill="#1e293b" tickFormatter={() => ''} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        ) : (
             <div className="space-y-4">
                {selectedProcesses.filter(p => !hiddenPids.has(p.pid)).map((p, idx) => (
                    <div key={`mem_split_${p.pid}`} className="h-[150px] border-b border-slate-800/50 pb-2">
                         <div className="text-xs text-slate-500 mb-1 flex justify-between">
                             <span>{p.name} ({p.pid})</span>
                             <span style={{ color: getColor(idx) }}>RSS</span>
                         </div>
                         <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                              <XAxis dataKey="timestamp" hide />
                              <YAxis stroke="#475569" fontSize={10} width={30} tickFormatter={(val) => (val/1024/1024).toFixed(0)} />
                              <Tooltip formatter={(val:number) => [formatBytes(val), '']} labelStyle={{ display: 'none' }} />
                              <Line type="monotone" dataKey={`rss_${p.pid}`} stroke={getColor(idx)} strokeWidth={2} dot={false} isAnimationActive={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                ))}
            </div>
        )}
      </div>

      {/* Chart 3: JS Heap (Browser Mode Only) */}
      {mode === 'browser' && (
      <div className={`bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-xl ${viewMode === 'split' ? 'h-auto' : 'h-[300px]'}`}>
        <div className="flex justify-between items-center mb-4">
           <h3 className="text-slate-400 font-medium flex items-center gap-2"><Database className="w-4 h-4" /> JS Heap Size (Browser API)</h3>
        </div>
        
        {viewMode === 'combined' ? (
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(time) => new Date(time).toLocaleTimeString()}
                    minTickGap={50}
                    stroke="#475569"
                    fontSize={10}
                  />
                  <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => formatBytes(val)} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    labelFormatter={(label) => new Date(label).toLocaleTimeString()}
                    formatter={(val: number) => [formatBytes(val), '']}
                  />
                  <Legend 
                     onClick={(e) => {
                        const dataKey = e.dataKey as string;
                        if (dataKey) {
                            const parts = dataKey.split('_');
                            if (parts.length >= 2) {
                                const pid = parseInt(parts[parts.length-1], 10);
                                if (!isNaN(pid)) onToggleVisibility(pid);
                            }
                        }
                    }} 
                    wrapperStyle={{ cursor: 'pointer' }}
                  />
                  {selectedProcesses.map((p, idx) => (
                      <Line 
                        key={`heap_${p.pid}`}
                        hide={hiddenPids.has(p.pid)}
                        name={`${p.title || p.name} (${p.pid})`}
                        type="monotone" 
                        dataKey={`heap_${p.pid}`} 
                        stroke={getColor(idx)} 
                        strokeWidth={2}
                        dot={false}
                        isAnimationActive={false} 
                      />
                  ))}
                  <Brush dataKey="timestamp" height={30} stroke="#4f46e5" fill="#1e293b" tickFormatter={() => ''} />
                </LineChart>
              </ResponsiveContainer>
            </div>
        ) : (
             <div className="space-y-4">
               {selectedProcesses.filter(p => !hiddenPids.has(p.pid)).map((p, idx) => (
                  <div key={`heap_split_${p.pid}`} className="h-[150px] border-b border-slate-800/50 pb-2">
                    <div className="text-xs text-slate-500 mb-1 flex justify-between">
                         <span>{p.title || p.name} ({p.pid})</span>
                         <span style={{ color: getColor(idx) }}>JS Heap</span>
                    </div>
                    <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                            <XAxis dataKey="timestamp" hide />
                            <YAxis stroke="#475569" fontSize={10} width={40} tickFormatter={(val) => formatBytes(val)} />
                            <Tooltip contentStyle={{ backgroundColor: '#0f172a' }} formatter={(val: number) => [formatBytes(val)]} labelFormatter={() => ''}/>
                            <Line type="monotone" dataKey={`heap_${p.pid}`} stroke={getColor(idx)} strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                    </ResponsiveContainer>
                  </div>
               ))}
             </div>
        )}
      </div>
      )}
    </div>
  );
};

