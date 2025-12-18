import React, { useState } from 'react';
import { Plus, Trash2, Code, Terminal, Ruler, Target, ChevronDown, ChevronRight, Edit2, Save, Info, X } from 'lucide-react';

export interface LogMetricConfig {
  name: string;
  pattern: string;
  unit?: string;
  target_pid?: number;
}

interface LogMetricSettingsProps {
  configs: LogMetricConfig[];
  onChange: (configs: LogMetricConfig[]) => void;
  disabled: boolean;
  defaultOpen?: boolean;
  showOptionalBadge?: boolean;
}

export const LogMetricSettings: React.FC<LogMetricSettingsProps> = ({
  configs,
  onChange,
  disabled,
  defaultOpen = true,
  showOptionalBadge = false,
}) => {
  const [newName, setNewName] = useState('');
  const [newPattern, setNewPattern] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [newPid, setNewPid] = useState('');
  
  const [isCollapsed, setIsCollapsed] = useState(!defaultOpen);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleSave = () => {
    if (!newName.trim() || !newPattern.trim()) return;
    
    const pid = parseInt(newPid.trim());
    const newItem = {
        name: newName.trim(),
        pattern: newPattern.trim(),
        unit: newUnit.trim() || undefined,
        target_pid: !isNaN(pid) && pid > 0 ? pid : undefined,
    };

    if (editingIndex !== null) {
        // Update existing
        const next = [...configs];
        next[editingIndex] = newItem;
        onChange(next);
        setEditingIndex(null);
    } else {
        // Add new
        onChange([...configs, newItem]);
    }
    
    setNewName('');
    setNewPattern('');
    setNewUnit('');
    setNewPid('');
  };

  const handleEdit = (index: number) => {
    const item = configs[index];
    setNewName(item.name);
    setNewPattern(item.pattern);
    setNewUnit(item.unit || '');
    setNewPid(item.target_pid ? String(item.target_pid) : '');
    setEditingIndex(index);
    setIsCollapsed(false); // Ensure form is visible
  };

  const handleCancelEdit = () => {
    setNewName('');
    setNewPattern('');
    setNewUnit('');
    setNewPid('');
    setEditingIndex(null);
  };

  const handleRemove = (index: number) => {
    if (editingIndex === index) handleCancelEdit();
    const next = [...configs];
    next.splice(index, 1);
    onChange(next);
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden dark:bg-slate-900 dark:border-slate-800">
      <button 
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="w-full flex items-center justify-between p-4 hover:bg-slate-50 transition-colors dark:hover:bg-slate-800/50"
      >
        <div className="flex items-center gap-2">
            {isCollapsed ? <ChevronRight className="w-4 h-4 text-slate-400"/> : <ChevronDown className="w-4 h-4 text-slate-400"/>}
            <Terminal className="w-4 h-4 text-slate-500" />
            <div className="text-sm text-slate-700 font-bold uppercase dark:text-slate-300">
            Log Metric Extraction
            </div>
            {showOptionalBadge && (
              <div className="text-xs text-slate-400 font-normal border border-slate-200 rounded px-1.5 py-0.5 ml-2 dark:border-slate-700">
                  Optional
              </div>
            )}
        </div>
        <div className="text-xs text-slate-400">
            {configs.length} rule{configs.length !== 1 ? 's' : ''} configured
        </div>
      </button>
      
      {!isCollapsed && (
        <div className="p-4 pt-0 border-t border-slate-100 dark:border-slate-800/50">
            <p className="text-xs text-slate-500 my-3 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                Extract metrics from console logs using Regex. Pattern must contain one capture group <code>(\d+)</code> for the value.
                </span>
            </p>

            {/* List */}
            <div className="space-y-2 mb-4">
                {configs.map((cfg, i) => (
                <div key={i} className={`flex items-center gap-2 p-2 rounded-lg border ${editingIndex === i ? 'bg-indigo-50 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800' : 'bg-slate-50 border-slate-200 dark:bg-slate-950 dark:border-slate-800'}`}>
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-200">{cfg.name}</span>
                        {cfg.unit && <span className="text-xs text-slate-500">({cfg.unit})</span>}
                        {cfg.target_pid && (
                        <span className="flex items-center gap-1 text-xs text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-100 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800">
                            <Target className="w-3 h-3" />
                            PID {cfg.target_pid}
                        </span>
                        )}
                    </div>
                    <div className="text-xs font-mono text-slate-500 truncate mt-0.5" title={cfg.pattern}>
                        /{cfg.pattern}/
                    </div>
                    </div>
                    <button
                        onClick={() => handleEdit(i)}
                        disabled={disabled || editingIndex === i}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded-md disabled:opacity-50"
                        title="Edit"
                    >
                        <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                    onClick={() => handleRemove(i)}
                    disabled={disabled}
                    className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md disabled:opacity-50"
                    title="Remove"
                    >
                    <Trash2 className="w-4 h-4" />
                    </button>
                </div>
                ))}
                
                {configs.length === 0 && (
                <div className="text-center py-3 text-xs text-slate-400 italic">
                    No metrics configured.
                </div>
                )}
            </div>

            {/* Add/Edit Form */}
            <div className={`grid grid-cols-1 md:grid-cols-12 gap-2 ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
                <div className="md:col-span-2">
                    <div className="relative">
                        <Code className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            placeholder="Name"
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                        />
                    </div>
                </div>
                <div className="md:col-span-2">
                    <div className="relative">
                        <Target className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                            value={newPid}
                            onChange={(e) => {
                                const v = e.target.value.replace(/[^0-9]/g, '');
                                setNewPid(v);
                            }}
                            placeholder="PID (opt)"
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                        />
                    </div>
                </div>
                <div className="md:col-span-5">
                    <div className="relative">
                        <div className="absolute left-2.5 top-2.5 font-mono text-slate-400 select-none">/</div>
                        <input
                            value={newPattern}
                            onChange={(e) => setNewPattern(e.target.value)}
                            placeholder="Regex (e.g. (\d+))"
                            className="w-full pl-6 pr-3 py-2 text-sm font-mono rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                        />
                    </div>
                </div>
                <div className="md:col-span-2">
                    <div className="relative">
                        <Ruler className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400" />
                        <input
                            value={newUnit}
                            onChange={(e) => setNewUnit(e.target.value)}
                            placeholder="Unit"
                            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200"
                        />
                    </div>
                </div>
                <div className="md:col-span-1 flex gap-1">
                    {editingIndex !== null && (
                        <button
                            onClick={handleCancelEdit}
                            className="w-full h-full flex items-center justify-center bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
                            title="Cancel Edit"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={!newName.trim() || !newPattern.trim()}
                        className={`w-full h-full flex items-center justify-center text-white rounded-lg disabled:opacity-50 disabled:cursor-not-allowed ${editingIndex !== null ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700'}`}
                        title={editingIndex !== null ? "Update Rule" : "Add Rule"}
                    >
                        {editingIndex !== null ? <Save className="w-4 h-4" /> : <Plus className="w-5 h-5" />}
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
  );
};
