
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import { LayoutDashboard, FileText } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { Reports } from './pages/Reports';
import { ReportDetail } from './pages/ReportDetail';
import { ReportCompare } from './pages/ReportCompare';

const NavLink = ({ to, icon: Icon, label }: any) => {
  const location = useLocation();
  const isActive = location.pathname === to || (to !== '/' && location.pathname.startsWith(to));
  
  return (
    <Link to={to} className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
      <Icon className="w-4 h-4" />
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
};

export default function App() {
  return (
    <div className="flex h-screen bg-slate-950 text-slate-200">
      {/* Sidebar Navigation */}
      <aside className="w-16 lg:w-64 border-r border-slate-800 bg-slate-900/50 flex flex-col shrink-0">
        <div className="p-4 border-b border-slate-800 flex items-center justify-center lg:justify-start gap-3">
           <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shrink-0 font-bold text-white">PS</div>
           <span className="font-bold text-lg hidden lg:block">PerfSight</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-2">
           <NavLink to="/" icon={LayoutDashboard} label="Dashboard" />
           <NavLink to="/reports" icon={FileText} label="Reports" />
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 h-full overflow-hidden relative">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/report/:id" element={<ReportDetail />} />
          <Route path="/compare" element={<ReportCompare />} />
        </Routes>
      </div>
    </div>
  );
}
