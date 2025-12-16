import React, { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from "react-router-dom";
import {
  FileText,
  Calendar,
  Clock,
  ChevronRight,
  GitCompare,
  CheckSquare,
  Square,
  Trash2,
} from "lucide-react";

interface ReportSummary {
  id: number;
  created_at: string;
  title: string;
  duration_seconds: number;
}

export const Reports: React.FC = () => {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const navigate = useNavigate();

  const loadReports = async () => {
    const data = (await invoke("get_reports")) as any;
    setReports(data);
  };

  useEffect(() => {
    loadReports().catch(console.error);
  }, []);

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else if (next.size < 2) next.add(id); // Limit to 2 for now
    setSelectedIds(next);
  };

  const handleCompare = () => {
    if (selectedIds.size !== 2) return;
    const ids = Array.from(selectedIds).join(",");
    navigate(`/compare?ids=${ids}`);
  };

  const confirmDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setConfirmBulk(true);
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    try {
      setIsDeleting(true);
      const ids = Array.from(selectedIds);
      await invoke("delete_reports", { ids });
      setSelectedIds(new Set());
      setConfirmBulk(false);
      await loadReports();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteOne = async (id: number) => {
    try {
      setIsDeleting(true);
      await invoke("delete_report", { id });
      const next = new Set(selectedIds);
      next.delete(id);
      setSelectedIds(next);
      setConfirmDeleteId(null);
      await loadReports();
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto text-slate-200">
      <div className="p-8 max-w-5xl mx-auto relative">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <FileText className="w-6 h-6 text-indigo-500" /> Test Reports
          </h1>

          <div className="flex items-center gap-3">
            <label className="bg-slate-800 hover:bg-slate-700 text-white px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors">
              {isImporting ? "Importing…" : "Import Dataset"}
              <input
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={isImporting}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    setIsImporting(true);
                    const text = await file.text();
                    const newId = (await invoke("import_report_dataset", {
                      datasetJson: text,
                    })) as number;
                    await loadReports();
                    navigate(`/report/${newId}`);
                  } catch (err) {
                    console.error("Import dataset failed", err);
                    alert("Failed to import dataset");
                  } finally {
                    setIsImporting(false);
                  }
                }}
              />
            </label>
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-4 bg-slate-900 border border-indigo-500/30 px-4 py-2 rounded-lg animate-in fade-in slide-in-from-bottom-2">
                <span className="text-sm text-slate-300">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={handleCompare}
                  disabled={selectedIds.size !== 2}
                  className="bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <GitCompare className="w-4 h-4" /> Compare
                </button>
                <button
                  onClick={confirmDeleteSelected}
                  className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-300"
                >
                  Clear
                </button>
              </div>
            )}
          </div>
        </div>

        {confirmBulk && (
          <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center justify-between">
            <div className="text-sm text-rose-200">
              Delete {selectedIds.size} report(s)? This cannot be undone.
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setConfirmBulk(false)}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-sm bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteSelected}
                disabled={isDeleting}
                className="px-3 py-1.5 rounded-md text-sm bg-rose-600 hover:bg-rose-500 disabled:opacity-60"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {reports.map((report) => {
            const isSelected = selectedIds.has(report.id);
            const isConfirmingThis = confirmDeleteId === report.id;
            return (
              <div
                key={report.id}
                onClick={() => navigate(`/report/${report.id}`)}
                className={`bg-slate-900 border rounded-lg p-4 transition-colors flex items-center justify-between group cursor-pointer ${
                  isSelected
                    ? "border-indigo-500 bg-indigo-900/10"
                    : "border-slate-800 hover:border-indigo-500/50"
                }`}
              >
                <div className="flex items-center gap-4 min-w-0">
                  <button
                    onClick={(e) => toggleSelect(report.id, e)}
                    className="text-slate-500 hover:text-indigo-400 transition-colors shrink-0"
                    title="Select for compare"
                  >
                    {isSelected ? (
                      <CheckSquare className="w-5 h-5 text-indigo-500" />
                    ) : (
                      <Square className="w-5 h-5" />
                    )}
                  </button>
                  <div className="min-w-0">
                    <div className="font-medium text-lg truncate">
                      {report.title}
                    </div>
                    <div className="text-sm text-slate-500 flex gap-4 mt-1 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />{" "}
                        {new Date(report.created_at).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />{" "}
                        {new Date(report.created_at).toLocaleTimeString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />{" "}
                        {Math.round(report.duration_seconds)}s
                      </span>
                    </div>
                    {isConfirmingThis && (
                      <div className="mt-3 flex items-center gap-2">
                        <span className="text-xs text-rose-200">
                          Delete this report? Cannot be undone.
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(null);
                          }}
                          disabled={isDeleting}
                          className="px-2 py-1 rounded-md text-xs bg-slate-800 hover:bg-slate-700 disabled:opacity-60"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteOne(report.id);
                          }}
                          disabled={isDeleting}
                          className="px-2 py-1 rounded-md text-xs bg-rose-600 hover:bg-rose-500 disabled:opacity-60"
                        >
                          Confirm
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDeleteId((cur) =>
                        cur === report.id ? null : report.id
                      );
                    }}
                    className="text-slate-500 hover:text-rose-400 transition-colors"
                    title="Delete report"
                  >
                    <Trash2 className="w-5 h-5" />
                  </button>
                  <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-indigo-400" />
                </div>
              </div>
            );
          })}
          {reports.length === 0 && (
            <div className="text-center text-slate-500 py-10">
              No reports found. Run a test to generate one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

