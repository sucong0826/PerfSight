import os
import json

# 项目根目录名称
PROJECT_NAME = "perf-sight"

# --- 1. 前端配置 (package.json) ---
# NOTE: 使用精确版本或更新的范围
PACKAGE_JSON = {
  "name": "perf-sight",
  "private": True,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "tauri": "tauri"
  },
  "dependencies": {
    "@tauri-apps/api": "^2.0.0-rc.0",
    "@tauri-apps/plugin-shell": "^2.0.0-rc.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.363.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "recharts": "^2.12.3",
    "tailwind-merge": "^2.2.2"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.0.0-rc.0",
    "@types/react": "^18.2.66",
    "@types/react-dom": "^18.2.22",
    "@vitejs/plugin-react": "^4.2.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.1",
    "typescript": "^5.2.2",
    "vite": "^5.2.0"
  }
}

# --- 2. Tailwind 配置 ---
TAILWIND_CONFIG = """
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
"""

POSTCSS_CONFIG = """
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
"""

# --- 3. Vite 配置 ---
VITE_CONFIG = """
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
"""

# --- 4. TSConfig ---
TS_CONFIG = {
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": True,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": True,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": True,
    "resolveJsonModule": True,
    "isolatedModules": True,
    "noEmit": True,
    "jsx": "react-jsx",
    "strict": True,
    "unusedLocals": True,
    "unusedParameters": True,
    "noFallthroughCasesInSwitch": True
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}

TS_CONFIG_NODE = {
  "compilerOptions": {
    "composite": True,
    "skipLibCheck": True,
    "module": "ESNext",
    "moduleResolution": "bundler",
    "allowSyntheticDefaultImports": True
  },
  "include": ["vite.config.ts"]
}

# --- 5. CSS ---
INDEX_CSS = """
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;
  line-height: 1.5;
  font-weight: 400;
  color-scheme: light dark;
  background-color: #0f172a; 
}

/* Custom Scrollbar */
.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: #1e293b; 
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: #475569; 
  border-radius: 3px;
}
.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background: #64748b; 
}
"""

# --- 6. React Entry ---
MAIN_TSX = """
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
"""

# --- 7. HTML Entry ---
INDEX_HTML = """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>PerfSight</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
"""

# --- 8. React App (FIXED SyntaxWarning in error message path) ---
# NOTE: The Mac path is correctly escaped here using double backslashes (\\)
APP_TSX = """
import React, { useState, useEffect, useRef } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, Legend
} from 'recharts';
import { 
  Play, Square, Activity, Cpu, Database, Zap, Search, AlertCircle, 
  Monitor, Layers, Globe, Box as BoxIcon, Server, RefreshCw
} from 'lucide-react';

// --- Types ---
interface ProcessInfo {
  pid: number;
  name: string;
  memory_usage: number; // RSS (OS)
  cpu_usage: number;    // OS Level
  proc_type: 'Browser' | 'GPU' | 'Renderer' | 'Utility' | 'Other';
  title?: string;       // From Browser Task Manager (CDP)
  url?: string;
}

interface MetricPoint {
  timestamp: string;
  pid: number;
  cpu_usage: number;
  memory_rss: number;
  js_heap_size?: number; // New: Browser Internal Metric
  gpu_usage?: number;
}

type DataSource = 'system' | 'browser';

// --- Invoke Helper ---
const invokeCommand = async (cmd: string, args: any = {}) => {
  // @ts-ignore
  if (window.__TAURI__) {
    // @ts-ignore
    const { invoke } = window.__TAURI__.core;
    return invoke(cmd, args);
  }
  
  // Mock Data for Preview
  console.log(`[Mock Invoke] ${cmd}`, args);
  await new Promise(r => setTimeout(r, 200));

  if (cmd === 'get_process_list') {
    const isBrowserMode = args.mode === 'browser';
    if (isBrowserMode) {
        return [
          { pid: 1003, name: 'chrome.exe', proc_type: 'Renderer', title: 'YouTube - Video', url: 'https://youtube.com', cpu_usage: 12.1, memory_usage: 1024 * 1024 * 500 },
          { pid: 1004, name: 'chrome.exe', proc_type: 'Renderer', title: 'GitHub - PerfSight', url: 'https://github.com', cpu_usage: 0.1, memory_usage: 1024 * 1024 * 80 },
        ];
    } else {
        return [
          { pid: 1001, name: 'chrome.exe', proc_type: 'Browser', title: 'Main Process', cpu_usage: 1.2, memory_usage: 1024 * 1024 * 150 },
          { pid: 1002, name: 'chrome.exe', proc_type: 'GPU', title: 'GPU Process', cpu_usage: 5.5, memory_usage: 1024 * 1024 * 300 },
          { pid: 1003, name: 'chrome.exe', proc_type: 'Renderer', title: 'Chrome Renderer', cpu_usage: 12.1, memory_usage: 1024 * 1024 * 500 },
        ];
    }
  }
  return null;
};

const getProcessIcon = (type: string) => {
  switch(type) {
    case 'GPU': return <Layers className="w-4 h-4 text-amber-400" />;
    case 'Renderer': return <Globe className="w-4 h-4 text-blue-400" />;
    case 'Browser': return <Monitor className="w-4 h-4 text-slate-400" />;
    default: return <BoxIcon className="w-4 h-4 text-slate-600" />;
  }
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

export default function App() {
  const [mode, setMode] = useState<DataSource>('system');
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [isCollecting, setIsCollecting] = useState(false);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const maxDataPoints = 60;
  const mockTimerRef = useRef<any>(null);

  // Auto-refresh process list when mode changes
  useEffect(() => {
    loadProcesses();
    // Clear selection when switching modes as PIDs might change visibility
    if (!isCollecting) setSelectedPid(null);
  }, [mode]);

  const loadProcesses = async () => {
    try {
      setError(null);
      const list = await invokeCommand('get_process_list', { mode }) as ProcessInfo[];
      // Sort logic
      const sorted = list.sort((a, b) => {
         // Put selected PID at top if exists
         if (a.pid === selectedPid) return -1;
         if (b.pid === selectedPid) return 1;
         // Prefer titled items (Tabs) in browser mode
         if (a.title && !b.title) return -1;
         if (!a.title && b.title) return 1;
         return b.cpu_usage - a.cpu_usage; // Then by CPU
      });
      setProcesses(sorted);
    } catch (e) {
      console.error(e);
      setError("Connection Failed. Ensure Chrome is started with: --remote-debugging-port=9222");
    }
  };

  const handleStart = async () => {
    if (!selectedPid) return;
    try {
      await invokeCommand('start_collection', { 
        config: { target_pid: selectedPid, interval_ms: 1000, mode: mode } 
      });
      setIsCollecting(true);
      setMetrics([]);
      
      // @ts-ignore
      if (window.__TAURI__) {
        // @ts-ignore
        const { listen } = window.__TAURI__.event;
        const unlisten = await listen('new-metric', (event: any) => {
           addMetric(event.payload);
        });
      } else {
        startMockDataGeneration(selectedPid);
      }
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const handleStop = async () => {
    try {
      await invokeCommand('stop_collection');
      setIsCollecting(false);
      if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    } catch (e: any) {
      setError(e.toString());
    }
  };

  const addMetric = (point: MetricPoint) => {
    setMetrics(prev => {
      const newMetrics = [...prev, point];
      if (newMetrics.length > maxDataPoints) return newMetrics.slice(newMetrics.length - maxDataPoints);
      return newMetrics;
    });
  };

  const startMockDataGeneration = (pid: number) => {
    if (mockTimerRef.current) clearInterval(mockTimerRef.current);
    mockTimerRef.current = setInterval(() => {
      addMetric({
        timestamp: new Date().toISOString(),
        pid: pid,
        cpu_usage: Math.random() * 30,
        memory_rss: 1024 * 1024 * (200 + Math.random() * 50),
        js_heap_size: mode === 'browser' ? 1024 * 1024 * (50 + Math.random() * 20) : undefined,
        gpu_usage: Math.random() * 10
      });
    }, 1000);
  };

  const currentMetric = metrics.length > 0 ? metrics[metrics.length - 1] : null;
  const selectedProcess = processes.find(p => p.pid === selectedPid);

  const filteredProcesses = processes.filter(p => 
    p.name.toLowerCase().includes(filterText.toLowerCase()) || 
    (p.title && p.title.toLowerCase().includes(filterText.toLowerCase()))
  );

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200 font-sans">
      <header className="flex items-center justify-between px-6 py-4 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <Activity className="w-6 h-6 text-indigo-500" />
          <h1 className="text-xl font-bold">PerfSight</h1>
          <div className="h-6 w-px bg-slate-700 mx-2"></div>
          
          {/* Mode Switcher */}
          <div className="flex bg-slate-950 p-1 rounded-lg border border-slate-800">
             <button 
                onClick={() => !isCollecting && setMode('system')}
                disabled={isCollecting}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'system' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-50`}
             >
               <Server className="w-3.5 h-3.5" /> System Level
             </button>
             <button 
                onClick={() => !isCollecting && setMode('browser')}
                disabled={isCollecting}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${mode === 'browser' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'} disabled:opacity-50`}
             >
               <Globe className="w-3.5 h-3.5" /> Browser API
             </button>
          </div>
        </div>

        <div className={`px-3 py-1 rounded-full text-sm font-medium ${isCollecting ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'}`}>
          {isCollecting ? 'Collecting' : 'Idle'}
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 gap-6 grid grid-cols-1 lg:grid-cols-4">
        {/* Left Panel: List */}
        <div className="lg:col-span-1 space-y-4 flex flex-col h-full overflow-hidden">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col flex-1 min-h-0 shadow-lg">
            <div className="flex justify-between items-center mb-3">
               <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-400">
                 <Search className="w-4 h-4" /> {mode === 'browser' ? 'Select Tab' : 'Select Process'}
               </h2>
               <button onClick={loadProcesses} disabled={isCollecting} className="p-1.5 hover:bg-slate-800 rounded text-slate-400">
                 <RefreshCw className={`w-3.5 h-3.5 ${isCollecting ? 'animate-spin' : ''}`} />
               </button>
            </div>
            
            <input 
              type="text" 
              placeholder={mode === 'browser' ? "Filter tabs..." : "Filter processes..."}
              className="bg-slate-950 border border-slate-800 rounded px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-500"
              value={filterText}
              onChange={e => setFilterText(e.target.value)}
            />

            <div className="flex-1 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
              {filteredProcesses.map(p => (
                <button 
                  key={p.pid}
                  onClick={() => !isCollecting && setSelectedPid(p.pid)}
                  disabled={isCollecting}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm flex items-center gap-3 transition-colors ${
                    selectedPid === p.pid 
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' 
                      : 'hover:bg-slate-800 text-slate-300'
                  } ${isCollecting ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="shrink-0 opacity-80">{getProcessIcon(p.proc_type)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">
                      {p.title || p.name}
                    </div>
                    <div className="text-xs opacity-60 truncate flex gap-2 items-center">
                      <span>{p.pid}</span>
                      {p.proc_type !== 'Browser' && <span>• {p.proc_type}</span>}
                    </div>
                  </div>
                </button>
              ))}
              {filteredProcesses.length === 0 && (
                <div className="text-center text-slate-500 py-4 text-sm">
                   {mode === 'browser' ? "No Chrome Tabs found." : "No processes found."}
                </div>
              )}
            </div>

            <div className="mt-4 flex gap-3 pt-3 border-t border-slate-800">
               {!isCollecting ? (
                <button onClick={handleStart} disabled={!selectedPid} className="flex-1 bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors"><Play className="w-4 h-4" /> Start</button>
              ) : (
                <button onClick={handleStop} className="flex-1 bg-rose-600 hover:bg-rose-500 text-white px-4 py-2 rounded-lg flex justify-center gap-2 items-center font-medium transition-colors"><Square className="w-4 h-4" /> Stop</button>
              )}
            </div>
          </div>
        </div>

        {/* Right Panel: Charts */}
        <div className="lg:col-span-3 space-y-6">
          {/* Metrics Overview */}
          <div className="grid grid-cols-4 gap-4">
             <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
               <p className="text-slate-500 text-xs uppercase font-bold">Target</p>
               <div className="mt-1 text-sm font-medium text-slate-200 truncate" title={selectedProcess?.title || selectedProcess?.name}>
                 {selectedProcess?.title || selectedProcess?.name || '-'}
               </div>
               <div className="text-xs text-indigo-400 mt-1">{selectedProcess?.proc_type || '-'} (PID: {selectedPid})</div>
            </div>
            
            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
               <p className="text-slate-500 text-xs uppercase font-bold">CPU (System)</p>
               <div className="mt-1 flex items-end gap-2">
                 <span className="text-3xl font-bold text-indigo-400">{currentMetric?.cpu_usage.toFixed(1) || '0.0'}</span>
                 <span className="text-sm">%</span>
               </div>
            </div>

            <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl">
               <p className="text-slate-500 text-xs uppercase font-bold">Memory (RSS)</p>
               <div className="mt-1 flex items-end gap-2">
                 <span className="text-3xl font-bold text-emerald-400">{formatBytes(currentMetric?.memory_rss || 0).split(' ')[0]}</span>
                 <span className="text-sm">MB</span>
               </div>
            </div>

             <div className="bg-slate-900/50 border border-slate-800 p-4 rounded-xl relative overflow-hidden">
               <p className="text-slate-500 text-xs uppercase font-bold">{mode === 'browser' ? 'JS Heap (Browser)' : 'GPU (Est.)'}</p>
               <div className="mt-1 flex items-end gap-2">
                 {mode === 'browser' ? (
                    <>
                    <span className="text-3xl font-bold text-amber-400">{formatBytes(currentMetric?.js_heap_size || 0).split(' ')[0]}</span>
                    <span className="text-sm">MB</span>
                    </>
                 ) : (
                    <>
                    <span className="text-3xl font-bold text-amber-400">{currentMetric?.gpu_usage?.toFixed(1) || '0.0'}</span>
                    <span className="text-sm">%</span>
                    </>
                 )}
               </div>
            </div>
          </div>

          {/* Chart 1: CPU */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[300px] shadow-xl">
            <h3 className="text-slate-400 font-medium mb-4 flex items-center gap-2"><Cpu className="w-4 h-4" /> CPU Load (System Level)</h3>
            <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metrics}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis stroke="#475569" fontSize={12} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    itemStyle={{ color: '#818cf8' }}
                  />
                  <Area type="monotone" dataKey="cpu_usage" stroke="#6366f1" fill="url(#colorCpu)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Chart 2: Memory (Dual Line if in Browser Mode) */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 h-[300px] shadow-xl">
            <h3 className="text-slate-400 font-medium mb-4 flex items-center gap-2">
              <Database className="w-4 h-4" /> Memory Usage {mode === 'browser' ? '(RSS vs JS Heap)' : '(RSS)'}
            </h3>
             <div className="w-full h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={metrics}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                  <XAxis dataKey="timestamp" hide />
                  <YAxis stroke="#475569" fontSize={12} tickFormatter={(val) => (val/1024/1024).toFixed(0)} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', color: '#f1f5f9' }}
                    labelStyle={{ display: 'none' }}
                    formatter={(val:number) => [formatBytes(val), '']}
                  />
                  <Legend />
                  <Line name="System RSS" type="monotone" dataKey="memory_rss" stroke="#34d399" strokeWidth={2} dot={false} isAnimationActive={false} />
                  {mode === 'browser' && (
                     <Line name="JS Heap (CDP)" type="monotone" dataKey="js_heap_size" stroke="#fbbf24" strokeWidth={2} dot={false} isAnimationActive={false} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          
           {error && (
            <div className="bg-rose-950/30 border border-rose-900/50 p-4 rounded-lg flex items-start gap-3 text-rose-300 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Error</p>
                <p>{error}</p>
                {mode === 'browser' && (
                    <p className="mt-2 text-xs opacity-70">
                        Browser Mode requires Chrome started with remote debugging.<br/>
                        Win: <code>chrome.exe --remote-debugging-port=9222</code><br/>
                        Mac: <code>/Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=9222</code>
                    </p>
                )}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
"""

# --- 9. Cargo.toml (Added Reqwest & FORCE UPDATED VERSIONS) ---
# FIXED: Updated versions to ^2.0.0-rc.10 to bypass the broken rc.0 release
CARGO_TOML = """
[package]
name = "perf-sight"
version = "0.1.0"
description = "PerfSight Native Client"
authors = ["Your Name"]
edition = "2021"

[build-dependencies]
tauri-build = { version = "^2.0.0-rc.10", features = [] }

[dependencies]
tauri = { version = "^2.0.0-rc.10", features = [] }
tauri-plugin-shell = "^2.0.0-rc.10"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
sysinfo = "0.30.13" 
tokio = { version = "1", features = ["full"] }
chrono = { version = "0.4", features = ["serde"] }
reqwest = { version = "0.11", features = ["json", "blocking"] } 
"""

# --- 10. Rust: models.rs (Updated) ---
RUST_MODELS = """
use serde::{Deserialize, Serialize};
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub memory_usage: u64, // bytes
    pub cpu_usage: f32,    // percentage
    // New fields
    pub proc_type: String, // Browser, GPU, Renderer, Utility, Other
    pub title: Option<String>,
    pub url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricPoint {
    pub timestamp: DateTime<Utc>,
    pub pid: u32,
    pub cpu_usage: f32,
    pub memory_rss: u64,
    pub gpu_usage: Option<f32>, 
    pub js_heap_size: Option<u64>, // Browser Metric
}

#[derive(Debug, Deserialize)]
pub struct CollectionConfig {
    pub target_pid: u32,
    pub interval_ms: u64,
    pub mode: String, // "system" | "browser"
}

// CDP JSON Structures (http://localhost:9222/json/list)
#[derive(Debug, Deserialize, Clone)]
pub struct CdpTarget {
    pub id: String,
    pub title: String,
    pub r#type: String, // "page", "iframe", "service_worker"
    pub url: String,
    pub webSocketDebuggerUrl: Option<String>,
}
"""

# --- 11. Rust: collector/mod.rs (Hybrid System + CDP) ---
RUST_COLLECTOR = """
use crate::models::{MetricPoint, ProcessInfo, CdpTarget};
use chrono::Utc;
use sysinfo::{Pid, Process, System};
use std::collections::HashMap;

pub trait ResourceCollector {
    fn update(&mut self); 
    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo>;
    fn collect_process(&self, pid: u32) -> Option<MetricPoint>;
}

pub struct GeneralCollector {
    system: System,
    // Cache map: PID -> CdpTarget
    // Used to enrich OS process list with Browser info
    cdp_map: HashMap<u32, CdpTarget>,
}

impl GeneralCollector {
    pub fn new() -> Self {
        let mut sys = System::new_all();
        sys.refresh_all();
        Self { 
            system: sys,
            cdp_map: HashMap::new()
        }
    }

    // Try to fetch Tab info from Chrome DevTools Protocol
    // Returns a simple mapping of title/url for heuristics
    fn fetch_cdp_targets(&self) -> Vec<CdpTarget> {
        // Use blocking reqwest for simplicity in Phase 1
        let url = "http://localhost:9222/json/list";
        match reqwest::blocking::get(url) {
            Ok(resp) => {
                if let Ok(targets) = resp.json::<Vec<CdpTarget>>() {
                    return targets;
                }
            },
            Err(_) => {
                // CDP not available (Chrome not started with debugging port)
            }
        }
        Vec::new()
    }
}

impl ResourceCollector for GeneralCollector {
    fn update(&mut self) {
        self.system.refresh_all();
    }

    fn scan_processes(&mut self, mode: &str) -> Vec<ProcessInfo> {
        self.system.refresh_processes();
        
        let mut results = Vec::new();
        let targets = if mode == "browser" { self.fetch_cdp_targets() } else { Vec::new() };

        for (pid, process) in self.system.processes() {
            let name = process.name().to_lowercase();
            // Match common browser executables
            let is_chrome_like = name.contains("chrome") || name.contains("edge") || name.contains("safari") || name.contains("firefox");
            
            if is_chrome_like {
                let cmd_args = process.cmd();
                let args_str = cmd_args.join(" ");
                
                let mut p_type = "Browser".to_string();
                let mut title = None;
                let mut url = None;

                // 1. Identify Type via Args
                if args_str.contains("--type=gpu-process") {
                    p_type = "GPU".to_string();
                    title = Some("GPU Process".to_string());
                } else if args_str.contains("--type=renderer") {
                    p_type = "Renderer".to_string();
                    title = Some("Renderer / Tab".to_string());
                } else if args_str.contains("--type=utility") {
                    p_type = "Utility".to_string();
                }

                // If in browser mode, and we successfully fetched targets, try to identify tabs
                if mode == "browser" && !targets.is_empty() {
                    // NOTE: A robust implementation requires using CDP SystemInfo.getProcessInfo 
                    // to map PIDs to Tabs correctly. This is a simplified heuristic.
                    
                    // We look for a process command line that includes a URL/title that might match
                    // a CDP target, though this is unreliable across OSes.
                    
                    // For the demo, we will prioritize showing the relevant *types* (Renderer, GPU).
                }

                results.push(ProcessInfo {
                    pid: pid.as_u32(),
                    name: name,
                    memory_usage: process.memory(),
                    cpu_usage: process.cpu_usage(),
                    proc_type: p_type,
                    title: title,
                    url: url,
                });
            }
        }
        
        // Final list in Browser Mode: Show actual Tabs detected via CDP
        if mode == "browser" && !targets.is_empty() {
            // Filter targets to only include 'page' type (actual tabs)
            let tab_targets = targets.into_iter()
                .filter(|t| t.r#type == "page" && t.webSocketDebuggerUrl.is_some());
                
            let mut final_list = Vec::new();
            
            // We use the targets to create synthetic entries for tabs 
            // since we can't reliably map PID from the targets list without a WebSocket connection.
            // For a running demo, we only show tabs, and use mock PID/metrics.
            
            // If we only show CDP targets, we lose OS CPU/Memory.
            // The best compromise is to show the *System PIDs* but *Prioritize* those with titles.
            // We return the raw OS data for all Chrome-like processes, and the front-end handles 
            // prioritizing the display based on `title`.
        }

        results
    }

    fn collect_process(&self, pid: u32) -> Option<MetricPoint> {
        let sys_pid = Pid::from(pid as usize);
        
        if let Some(process) = self.system.process(sys_pid) {
            
            // In "Browser Mode", we would execute a CDP command here to get JS Heap.
            // Since this is a prototype, we mock the JS Heap data for processes identified as Renderers/Tabs
            let _js_heap_mock = if pid % 2 == 0 { Some(1024 * 1024 * 40) } else { None };

            Some(MetricPoint {
                timestamp: Utc::now(),
                pid,
                cpu_usage: process.cpu_usage(), 
                memory_rss: process.memory(),
                gpu_usage: None, 
                // Assign a mock JS Heap size if the process is relevant
                js_heap_size: if process.name().contains("renderer") { 
                    Some(process.memory() / 10) // Mock as 10% of RSS
                } else { 
                    None 
                },
            })
        } else {
            None
        }
    }
}

pub fn create_collector() -> Box<dyn ResourceCollector + Send> {
    Box::new(GeneralCollector::new())
}
"""

# --- 12. Rust: commands.rs (Updated) ---
RUST_COMMANDS = """
use tauri::{AppHandle, Emitter, Manager, State};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::task::JoinHandle;
use crate::models::{CollectionConfig, ProcessInfo};
use crate::collector::{create_collector};

pub struct CollectionState {
    pub handle: Arc<Mutex<Option<JoinHandle<()>>>>,
    pub is_running: Arc<Mutex<bool>>,
}

impl CollectionState {
    pub fn new() -> Self {
        Self {
            handle: Arc::new(Mutex::new(None)),
            is_running: Arc::new(Mutex::new(false)),
        }
    }
}

// Struct for arguments
#[derive(serde::Deserialize)]
pub struct ProcessListArgs {
    mode: String,
}

#[tauri::command]
pub async fn get_process_list(args: Option<ProcessListArgs>) -> Result<Vec<ProcessInfo>, String> {
    let mode = args.map(|a| a.mode).unwrap_or("system".to_string());

    let res = tokio::task::spawn_blocking(move || {
        let mut collector = create_collector();
        collector.scan_processes(&mode)
    }).await.map_err(|e| e.to_string())?;
    
    Ok(res)
}

#[tauri::command]
pub async fn start_collection(
    app_handle: AppHandle,
    state: State<'_, CollectionState>,
    config: CollectionConfig
) -> Result<String, String> {
    let mut running = state.is_running.lock().unwrap();
    if *running {
        return Ok("Already running".to_string());
    }
    *running = true;

    let is_running_clone = state.is_running.clone();
    let pid = config.target_pid;
    let interval = config.interval_ms;
    // Pass mode to the collector task so it knows whether to fetch CDP data
    let _mode = config.mode.clone(); 

    let task = tokio::spawn(async move {
        let mut collector = create_collector();
        
        while *is_running_clone.lock().unwrap() {
            collector.update();
            
            if let Some(metric) = collector.collect_process(pid) {
                // The collector handles whether to include CDP data based on the mode 
                // in the collect_process logic (currently mocked).
                if let Err(e) = app_handle.emit("new-metric", &metric) {
                    eprintln!("Emit error: {}", e);
                }
            } else {
                eprintln!("Target process lost: {}", pid);
            }

            tokio::time::sleep(Duration::from_millis(interval)).await;
        }
    });

    let mut handle_guard = state.handle.lock().unwrap();
    *handle_guard = Some(task);

    Ok("Started".to_string())
}

#[tauri::command]
pub fn stop_collection(state: State<'_, CollectionState>) -> Result<String, String> {
    let mut running = state.is_running.lock().unwrap();
    *running = false;
    
    let mut handle = state.handle.lock().unwrap();
    if let Some(h) = handle.take() {
        h.abort();
    }
    
    Ok("Stopped".to_string())
}
"""

# --- Tauri Config & Rust Main/Lib (Standard) ---
TAURI_CONF_FIXED = {
  "build": {
    "beforeDevCommand": "npm run dev",
    "beforeBuildCommand": "npm run build",
    "devUrl": "http://localhost:1420",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      {
        "title": "PerfSight",
        "width": 1200,
        "height": 800
      }
    ],
    "security": {
      "csp": None
    }
  },
  "bundle": {
    "active": True,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "version": "0.1.0",
  "identifier": "com.perfsight.app"
}

RUST_MAIN = """
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() { perf_sight_lib::run(); }
"""

RUST_LIB = """
pub mod models;
pub mod collector;
pub mod commands;
use commands::CollectionState;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(CollectionState::new())
        .invoke_handler(tauri::generate_handler![
            commands::get_process_list,
            commands::start_collection,
            commands::stop_collection
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
"""

# --- 构建逻辑 ---

def write_file(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)

def write_json(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(content, f, indent=2)

def main():
    root = PROJECT_NAME
    if os.path.exists(root):
        print(f"Warning: Directory '{root}' already exists. Overwriting files.")
    
    os.makedirs(root, exist_ok=True)

    # 根目录文件
    write_json(f"{root}/package.json", PACKAGE_JSON)
    write_file(f"{root}/vite.config.ts", VITE_CONFIG)
    write_file(f"{root}/tailwind.config.js", TAILWIND_CONFIG)
    write_file(f"{root}/postcss.config.js", POSTCSS_CONFIG)
    write_json(f"{root}/tsconfig.json", TS_CONFIG)
    write_json(f"{root}/tsconfig.node.json", TS_CONFIG_NODE)
    write_file(f"{root}/index.html", INDEX_HTML)

    # 前端 Src
    write_file(f"{root}/src/main.tsx", MAIN_TSX)
    write_file(f"{root}/src/App.tsx", APP_TSX)
    write_file(f"{root}/src/index.css", INDEX_CSS)
    write_file(f"{root}/src/vite-env.d.ts", '/// <reference types="vite/client" />')

    # 后端 Tauri
    tauri_root = f"{root}/src-tauri"
    write_file(f"{tauri_root}/Cargo.toml", CARGO_TOML)
    write_json(f"{tauri_root}/tauri.conf.json", TAURI_CONF_FIXED)
    write_file(f"{tauri_root}/build.rs", "fn main() { tauri_build::build() }")
    
    write_file(f"{tauri_root}/src/main.rs", RUST_MAIN)
    write_file(f"{tauri_root}/src/lib.rs", RUST_LIB)
    write_file(f"{tauri_root}/src/models.rs", RUST_MODELS)
    write_file(f"{tauri_root}/src/commands.rs", RUST_COMMANDS)
    write_file(f"{tauri_root}/src/collector/mod.rs", RUST_COLLECTOR)

    # 创建必要的空目录和图标文件
    icon_dir = f"{tauri_root}/icons"
    os.makedirs(icon_dir, exist_ok=True)
    
    # Create empty placeholder files for the required icons
    icon_files = [
        "32x32.png", 
        "128x128.png", 
        "128x128@2x.png", 
        "icon.icns", 
        "icon.ico"
    ]
    for filename in icon_files:
        write_file(f"{icon_dir}/{filename}", "")


main()