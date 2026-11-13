import { useEffect, useState } from "react";
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText, GitCompare, Sun, Moon, Info, X, Github, ExternalLink, Settings, PanelLeftClose, PanelLeftOpen, Activity } from "lucide-react";
import { Dashboard } from "./pages/Dashboard";
import { SettingsPage } from "./pages/Settings";
import { Reports } from "./pages/Reports";
import { ReportDetail } from "./pages/ReportDetail";
import { ReportCompare } from "./pages/ReportCompare";
import { Comparisons } from "./pages/Comparisons";
import { ComparisonDetail } from "./pages/ComparisonDetail";
import { RetestPreview } from "./pages/RetestPreview";
import { FloatingWidget } from "./pages/FloatingWidget";
import { useTheme } from "./theme";
import { NotificationCenter, NotificationProvider } from "./components/Notifications";

const APP_VERSION = "0.1.0";

const NavLink = ({ to, icon: Icon, label, collapsed }: any) => {
  const location = useLocation();
  const isActive =
    location.pathname === to ||
    (to !== "/" && location.pathname.startsWith(to));

  return (
    <Link
      to={to}
      title={collapsed ? label : undefined}
      aria-label={label}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${
        isActive
          ? "bg-indigo-600 text-white"
          : "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800"
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${collapsed ? "mx-auto" : ""}`} />
      {!collapsed && <span className="text-sm font-medium">{label}</span>}
    </Link>
  );
};

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const [showAbout, setShowAbout] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("perfsight_sidebar_collapsed") === "true";
    } catch {
      return false;
    }
  });
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem("perfsight_sidebar_collapsed", String(sidebarCollapsed));
    } catch {
      // Sidebar state is a convenience; the app remains usable if storage is unavailable.
    }
  }, [sidebarCollapsed]);

  // Render widget without sidebar
  if (location.pathname === "/widget") {
    return (
      <NotificationProvider>
        <div className="w-screen h-screen">
          <FloatingWidget />
        </div>
      </NotificationProvider>
    );
  }

  return (
    <NotificationProvider>
    <div className="flex h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      {/* Sidebar Navigation */}
      <aside className={`${sidebarCollapsed ? "w-16" : "w-64"} border-r border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/50 flex flex-col shrink-0 transition-[width] duration-200`}>
        <div className={`border-b border-slate-200 dark:border-slate-800 ${sidebarCollapsed ? "p-2" : "p-3"}`}>
          <div className={`flex items-center ${sidebarCollapsed ? "flex-col gap-2" : "justify-between gap-2"}`}>
          <div title="PerfSight" className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0 text-white">
            <Activity className="h-5 w-5" />
          </div>
          {!sidebarCollapsed && (
            <div className="flex items-center gap-1">
              <NotificationCenter />
          <button
            type="button"
            onClick={toggleTheme}
            className="inline-flex items-center justify-center w-9 h-9 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:text-slate-300 transition-colors"
            title={theme === "dark" ? "Switch to Light" : "Switch to Dark"}
          >
            {theme === "dark" ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
              <button
                type="button"
                onClick={() => setSidebarCollapsed(true)}
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
          )}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={() => setSidebarCollapsed(false)}
              aria-label="Expand sidebar"
              title="Expand sidebar"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          )}
          </div>
          {sidebarCollapsed && (
            <div className="mt-2 flex flex-col items-center gap-1">
              <NotificationCenter />
              <button
                type="button"
                onClick={toggleTheme}
                title={theme === "dark" ? "Switch to Light" : "Switch to Dark"}
                aria-label={theme === "dark" ? "Switch to Light" : "Switch to Dark"}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
            </div>
          )}
        </div>

        <nav className={`flex-1 space-y-2 ${sidebarCollapsed ? "p-2" : "p-4"}`}>
          <NavLink to="/" icon={LayoutDashboard} label="Dashboard" collapsed={sidebarCollapsed} />
          <NavLink to="/reports" icon={FileText} label="Reports" collapsed={sidebarCollapsed} />
          <NavLink to="/comparisons" icon={GitCompare} label="Comparisons" collapsed={sidebarCollapsed} />
          <NavLink to="/settings" icon={Settings} label="Settings" collapsed={sidebarCollapsed} />
        </nav>

        {/* About button at bottom */}
        <div className={`${sidebarCollapsed ? "p-2" : "p-4"} border-t border-slate-200 dark:border-slate-800`}>
          <button
            type="button"
            onClick={() => setShowAbout(true)}
            title={sidebarCollapsed ? "About" : undefined}
            aria-label="About"
            className={`flex items-center gap-2 rounded-lg transition-colors w-full text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800 ${sidebarCollapsed ? "justify-center px-2 py-2" : "px-4 py-2"}`}
          >
            <Info className="w-4 h-4" />
            {!sidebarCollapsed && <span className="text-sm font-medium">About</span>}
          </button>
        </div>
      </aside>

      {/* About Modal */}
      {showAbout && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <div>
                  <h2 className="text-lg font-bold">PerfSight</h2>
                  <p className="text-xs text-slate-500">Performance Monitoring Tool</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAbout(false)}
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                  <div className="text-xs text-slate-500 mb-1">Version</div>
                  <div className="font-mono font-bold text-indigo-600 dark:text-indigo-400">v{APP_VERSION}</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                  <div className="text-xs text-slate-500 mb-1">Platform</div>
                  <div className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {navigator.platform.includes("Mac") ? "macOS" : navigator.platform.includes("Win") ? "Windows" : "Linux"}
                  </div>
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-2">Description</div>
                <p className="text-sm text-slate-700 dark:text-slate-300">
                  PerfSight is a cross-platform performance monitoring tool for analyzing CPU, memory, and other metrics of desktop applications and browser processes.
                </p>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                <div className="text-xs text-slate-500 mb-2">Features</div>
                <ul className="text-sm text-slate-700 dark:text-slate-300 space-y-1">
                  <li>• System API & Browser API collection modes</li>
                  <li>• Real-time metrics visualization</li>
                  <li>• Multi-report comparison</li>
                  <li>• PDF & Dataset export/import</li>
                  <li>• Server sync support</li>
                </ul>
              </div>
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30">
              <div className="flex items-center justify-between">
                <a
                  href="https://github.com/nicholassu/perfsight"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors"
                >
                  <Github className="w-4 h-4" />
                  GitHub
                  <ExternalLink className="w-3 h-3" />
                </a>
                <span className="text-xs text-slate-400">© 2025 PerfSight</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 h-full overflow-hidden relative">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/report/:id" element={<ReportDetail />} />
          <Route path="/retest/:id" element={<RetestPreview />} />
          <Route path="/compare" element={<ReportCompare />} />
          <Route path="/comparisons" element={<Comparisons />} />
          <Route path="/comparison/:id" element={<ComparisonDetail />} />
          <Route path="/widget" element={<FloatingWidget />} />
        </Routes>
      </div>
    </div>
    </NotificationProvider>
  );
}
