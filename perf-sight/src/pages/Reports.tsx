import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import { buildReportPdfDataUri } from "../utils/bulkExport";
import {
  FileText,
  Calendar,
  Clock,
  GitCompare,
  CheckSquare,
  Square,
  Trash2,
  RotateCcw,
  FolderPlus,
  Folder,
  Pencil,
  Trash,
  File,
  X,
} from "lucide-react";

interface ReportSummary {
  id: number;
  created_at: string;
  title: string;
  duration_seconds: number;
  tags: string[];
  folder_path?: string;
}

interface TagStat {
  tag: string;
  count: number;
}

interface FolderInfo {
  path: string; // "" means root
}

interface FolderStats {
  path: string;
  report_count: number;
  child_folder_count: number;
}

type FolderNode = {
  path: string; // "" means root
  name: string;
  children: FolderNode[];
};

const normFolder = (raw: any) => {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  return s
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== ".")
    .join("/");
};

export const Reports: React.FC = () => {
  const navigate = useNavigate();

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>(""); // "" root
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [includeSubfolders, setIncludeSubfolders] = useState(true);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isImporting, setIsImporting] = useState(false);
  const [isExportingBundle, setIsExportingBundle] = useState(false);

  const [knownTags, setKnownTags] = useState<TagStat[]>([]);
  const [tagQuery, setTagQuery] = useState("");
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set());
  const [tagMatchMode, setTagMatchMode] = useState<"any" | "all">("any");

  const [moveModal, setMoveModal] = useState<
    | { ids: number[]; currentFolder: string }
    | null
  >(null);
  const [isMoving, setIsMoving] = useState(false);

  const [folderModal, setFolderModal] = useState<
    | { kind: "create" }
    | { kind: "rename"; currentPath: string }
    | { kind: "delete"; currentPath: string; stats?: FolderStats | null }
    | null
  >(null);
  const [folderNameDraft, setFolderNameDraft] = useState("");
  const [deleteStrategy, setDeleteStrategy] = useState<
    "move_to_parent" | "move_to_root"
  >("move_to_parent");
  const [isFolderOp, setIsFolderOp] = useState(false);

  const viewMode: "folder" | "tags" = filterTags.size > 0 ? "tags" : "folder";

  const loadReports = async () => {
    const data = (await invoke("get_reports")) as any;
    setReports(data || []);
  };

  const loadFolders = async () => {
    try {
      const data = (await invoke("list_folder_paths")) as FolderInfo[];
      setFolders(data || []);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add("");
        return next;
      });
    } catch (e) {
      console.warn("list_folder_paths failed", e);
      setFolders([{ path: "" }]);
    }
  };

  useEffect(() => {
    loadReports().catch(console.error);
    loadFolders().catch(console.error);
    (async () => {
      try {
        const stats = (await invoke("get_known_tags")) as TagStat[];
        setKnownTags(stats || []);
      } catch {
        // ignore
      }
    })();
  }, []);

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleCompare = () => {
    if (selectedIds.size < 2) return;
    navigate(`/compare?ids=${Array.from(selectedIds).join(",")}`);
  };

  const confirmDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setConfirmBulk(true);
  };

  const handleExportSelectedZip = async () => {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    try {
      setIsExportingBundle(true);
      const items: Array<{ report_id: number; pdf_base64?: string | null }> = [];
      for (const id of ids) {
        const report = (await invoke("get_report_detail", { id })) as any;
        const pdf = await buildReportPdfDataUri({
          id: report.id,
          created_at: report.created_at,
          title: report.title,
          metrics: report.metrics,
          analysis: report.analysis,
          meta: report.meta,
        });
        items.push({ report_id: id, pdf_base64: pdf });
      }
      const outPath = (await invoke("export_reports_bundle_zip", {
        items,
        filename: null,
      })) as string;
      alert(`Exported ZIP:\n${outPath}`);
    } catch (e) {
      console.error("Export ZIP failed", e);
      alert("Failed to export ZIP");
    } finally {
      setIsExportingBundle(false);
    }
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

  const matchesTagFilter = (report: ReportSummary) => {
    if (!filterTags.size) return true;
    const reportTags = (report.tags || []).map((t) => t.toLowerCase());
    if (tagMatchMode === "all") {
      for (const ft of filterTags) {
        if (!reportTags.includes(ft.toLowerCase())) return false;
      }
      return true;
    }
    for (const ft of filterTags) {
      if (reportTags.includes(ft.toLowerCase())) return true;
    }
    return false;
  };

  const folderFilteredReports = useMemo(() => {
    const base = reports.filter(matchesTagFilter);
    if (viewMode === "tags") return base;
    const folder = normFolder(selectedFolder);
    if (!folder) {
      if (includeSubfolders) return base;
      return base.filter((r) => normFolder(r.folder_path) === "");
    }
    return base.filter((r) => {
      const fp = normFolder(r.folder_path);
      if (includeSubfolders) return fp === folder || fp.startsWith(folder + "/");
      return fp === folder;
    });
  }, [reports, selectedFolder, includeSubfolders, filterTags, tagMatchMode]);

  const treeReports = useMemo(() => {
    // Tree should reflect current tag filter (so users can still navigate),
    // but not be limited by the currently selected folder.
    return reports.filter(matchesTagFilter);
  }, [reports, filterTags, tagMatchMode]);

  const reportsByFolder = useMemo(() => {
    const m = new Map<string, ReportSummary[]>();
    for (const r of treeReports) {
      const fp = normFolder(r.folder_path);
      if (!m.has(fp)) m.set(fp, []);
      m.get(fp)!.push(r);
    }
    // newest first
    for (const arr of m.values()) {
      arr.sort((a, b) => b.id - a.id);
    }
    return m;
  }, [treeReports]);

  const tree: FolderNode = useMemo(() => {
    const all = new Set<string>((folders || []).map((f) => normFolder(f.path)));
    all.add("");
    // Ensure prefixes exist
    Array.from(all).forEach((p) => {
      if (!p) return;
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) {
        all.add(parts.slice(0, i).join("/"));
      }
    });

    const root: FolderNode = { path: "", name: "Root", children: [] };
    const byPath = new Map<string, FolderNode>();
    byPath.set("", root);
    const sorted = Array.from(all).sort((a, b) => a.localeCompare(b));
    for (const p of sorted) {
      if (p === "") continue;
      const parts = p.split("/");
      const name = parts[parts.length - 1];
      const node: FolderNode = { path: p, name, children: [] };
      byPath.set(p, node);
    }
    for (const [p, node] of byPath.entries()) {
      if (p === "") continue;
      const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      const parentNode = byPath.get(parent) || root;
      parentNode.children.push(node);
    }
    const sortRec = (n: FolderNode) => {
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }, [folders]);

  const tagSuggestions = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return [];
    return (knownTags || [])
      .filter((t) => t.tag.toLowerCase().includes(q))
      .slice(0, 10);
  }, [knownTags, tagQuery]);

  const renderFolderNode = (n: FolderNode, depth: number) => {
    const isExpanded = expanded.has(n.path);
    const isSelected = selectedFolder === n.path && viewMode === "folder";
    const files = reportsByFolder.get(n.path) ?? [];
    const hasExpandable = n.children.length > 0 || files.length > 0;
    return (
      <div key={`f_${n.path || "root"}`}>
        <button
          type="button"
          onDragOver={(e) => {
            e.preventDefault();
          }}
          onDrop={async (e) => {
            e.preventDefault();
            try {
              const raw = e.dataTransfer.getData("application/perfsight-report-ids");
              if (!raw) return;
              const ids = JSON.parse(raw) as number[];
              const clean = (Array.isArray(ids) ? ids : [])
                .map((x) => Number(x))
                .filter((x) => Number.isFinite(x));
              if (!clean.length) return;
              await moveIdsToFolder(clean, n.path);
            } catch (err) {
              console.warn("Drop move failed", err);
            }
          }}
          onClick={() => {
            setSelectedFolder(n.path);
            if (moveModal) {
              setMoveModal((m) => (m ? { ...m, currentFolder: n.path } : m));
            }
            setExpanded((prev) => {
              const next = new Set(prev);
              // Toggle expand/collapse on folder click.
              if (next.has(n.path)) next.delete(n.path);
              else next.add(n.path);
              // Ensure root is always present so root node remains addressable.
              next.add("");
              return next;
            });
          }}
          className={`w-full text-left px-2 py-1.5 rounded-md flex items-center gap-2 transition-colors ${
            isSelected
              ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-200"
              : "hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-900 dark:text-slate-300"
          }`}
          style={{ paddingLeft: 6 + depth * 14 }}
        >
          <span
            className="w-5 text-slate-500"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(n.path)) next.delete(n.path);
                else next.add(n.path);
                next.add("");
                return next;
              });
            }}
            title={isExpanded ? "Collapse" : "Expand"}
          >
            {hasExpandable ? (isExpanded ? "▾" : "▸") : ""}
          </span>
          <Folder className="w-4 h-4 text-slate-500" />
          <span className="truncate">{n.name}</span>
        </button>
        {isExpanded && (
          <div>
            {n.children.map((c) => renderFolderNode(c, depth + 1))}
            {files.slice(0, 50).map((r) => {
              const isRowSelected = selectedIds.has(r.id);
              return (
                <button
                  key={`file_${n.path}_${r.id}`}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    const ids = isRowSelected ? Array.from(selectedIds) : [r.id];
                    e.dataTransfer.setData(
                      "application/perfsight-report-ids",
                      JSON.stringify(ids)
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/report/${r.id}`);
                  }}
                  className={`w-full text-left px-2 py-1 rounded-md flex items-center gap-2 transition-colors ${
                    isRowSelected
                      ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-200"
                      : "hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-900 dark:text-slate-300"
                  }`}
                  style={{ paddingLeft: 26 + (depth + 1) * 14 }}
                  title={r.title}
                >
                  <File className="w-4 h-4 text-slate-500" />
                  <span className="truncate">{r.title}</span>
                </button>
              );
            })}
            {files.length > 50 ? (
              <div
                className="text-[11px] text-slate-500 px-2 py-1"
                style={{ paddingLeft: 26 + (depth + 1) * 14 }}
              >
                Showing first 50 reports in this folder.
              </div>
            ) : null}
          </div>
        )}
      </div>
    );
  };

  const moveIdsToFolder = async (ids: number[], folderPath: string) => {
    const path = folderPath.trim();
    try {
      if (ids.length === 1) {
        await invoke("update_report_folder_path", { id: ids[0], folderPath: path });
      } else {
        await invoke("update_reports_folder_path", { ids, folderPath: path });
      }
      await loadReports();
      await loadFolders();
    } catch (e) {
      console.error("Move failed", e);
      alert("Failed to move");
    }
  };

  const openCreateFolder = () => {
    setFolderNameDraft("");
    setFolderModal({ kind: "create" });
  };

  const openRenameFolder = () => {
    if (!selectedFolder) return;
    const leaf = selectedFolder.includes("/")
      ? selectedFolder.slice(selectedFolder.lastIndexOf("/") + 1)
      : selectedFolder;
    setFolderNameDraft(leaf);
    setFolderModal({ kind: "rename", currentPath: selectedFolder });
  };

  const openDeleteFolder = async () => {
    if (!selectedFolder) return;
    try {
      const stats = (await invoke("get_folder_stats", {
        path: selectedFolder,
      })) as FolderStats;
      setDeleteStrategy("move_to_parent");
      setFolderModal({ kind: "delete", currentPath: selectedFolder, stats });
    } catch (e) {
      console.error("get_folder_stats failed", e);
      setFolderModal({ kind: "delete", currentPath: selectedFolder, stats: null });
    }
  };

  return (
    <div className="h-full overflow-hidden bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-200">
      <div className="h-full flex">
        {/* Left: Folder tree */}
        <div className="w-[320px] border-r border-slate-200 bg-white dark:bg-slate-950 dark:border-slate-800 flex flex-col">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-500" />
                Reports
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={openCreateFolder}
                  className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
                  title="New folder"
                >
                  <FolderPlus className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={openRenameFolder}
                  disabled={!selectedFolder}
                  className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
                  title="Rename folder"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={openDeleteFolder}
                  disabled={!selectedFolder}
                  className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
                  title="Delete folder"
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {viewMode === "tags"
                ? "Tag view (flat results)"
                : `Folder: ${selectedFolder || "Root"}`}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {renderFolderNode(tree, 0)}
          </div>
        </div>

        {/* Right: List + tag filters + bulk actions */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
              <div className="flex items-center gap-3">
                <div className="text-lg font-bold">Test Reports</div>
                <label className="text-xs text-slate-500 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={includeSubfolders}
                    onChange={(e) => setIncludeSubfolders(e.target.checked)}
                    disabled={viewMode === "tags"}
                  />
                  include subfolders
                </label>
              </div>

              <div className="flex items-center gap-3">
                <label className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors dark:bg-slate-800 dark:hover:bg-slate-700">
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
                        await loadFolders();
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
              </div>
            </div>

            {/* Tag search / filter bar */}
            <div className="mb-4 bg-white border border-slate-200 rounded-xl p-4 dark:bg-slate-900 dark:border-slate-800">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-[280px]">
                  <div className="text-xs text-slate-500 mb-1">Filter by tag (flat results)</div>
                  <div className="relative">
                    <input
                      value={tagQuery}
                      onChange={(e) => setTagQuery(e.target.value)}
                      className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                      placeholder="Search tags…"
                    />
                    {tagSuggestions.length > 0 && (
                      <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-xl dark:bg-slate-950 dark:border-slate-800">
                        {tagSuggestions.map((t) => (
                          <button
                            key={`sugg_${t.tag}`}
                            type="button"
                            onClick={() => {
                              setFilterTags((prev) => new Set(prev).add(t.tag));
                              setTagQuery("");
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-900"
                          >
                            <span className="font-medium">{t.tag}</span>{" "}
                            <span className="text-xs text-slate-500">({t.count})</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 dark:bg-slate-800 dark:border-slate-700">
                    <button
                      onClick={() => setTagMatchMode("any")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        tagMatchMode === "any"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      ANY
                    </button>
                    <button
                      onClick={() => setTagMatchMode("all")}
                      className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                        tagMatchMode === "all"
                          ? "bg-white text-slate-900 shadow-sm dark:bg-slate-950 dark:text-white"
                          : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200"
                      }`}
                    >
                      ALL
                    </button>
                  </div>
                  {filterTags.size > 0 && (
                    <button
                      onClick={() => setFilterTags(new Set())}
                      className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                    >
                      Clear tags
                    </button>
                  )}
                </div>
              </div>

              {filterTags.size > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {Array.from(filterTags).map((t) => (
                    <button
                      key={`active_${t}`}
                      type="button"
                      onClick={() => {
                        setFilterTags((prev) => {
                          const next = new Set(prev);
                          for (const existing of next) {
                            if (existing.toLowerCase() === t.toLowerCase()) {
                              next.delete(existing);
                              break;
                            }
                          }
                          return next;
                        });
                      }}
                      className="px-2 py-1 rounded-md text-xs bg-indigo-600/10 border border-indigo-500/30 text-indigo-700 hover:bg-indigo-600/15 dark:bg-indigo-600/20 dark:text-indigo-200 dark:hover:bg-indigo-600/30"
                      title="Click to remove from filter"
                    >
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="mb-4 flex items-center gap-4 bg-white border border-indigo-500/30 px-4 py-2 rounded-lg dark:bg-slate-900">
                <span className="text-sm text-slate-700 dark:text-slate-300">
                  {selectedIds.size} selected
                </span>
                <button
                  onClick={() =>
                    setMoveModal({
                      ids: Array.from(selectedIds),
                      currentFolder: selectedFolder,
                    })
                  }
                  className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
                  title="Move selected reports to a folder"
                >
                  Move…
                </button>
                <button
                  onClick={handleExportSelectedZip}
                  disabled={isExportingBundle}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white px-3 py-1.5 rounded-md text-sm font-medium transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
                  title="Export selected reports as a single ZIP (dataset + PDF for each report)"
                >
                  {isExportingBundle ? "Exporting…" : "Export…"}
                </button>
                <button
                  onClick={handleCompare}
                  disabled={selectedIds.size < 2}
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
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  Clear selection
                </button>
              </div>
            )}

            {confirmBulk && (
              <div className="mb-4 bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 flex items-center justify-between">
                <div className="text-sm text-rose-700 dark:text-rose-200">
                  Delete {selectedIds.size} report(s)? This cannot be undone.
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setConfirmBulk(false)}
                    disabled={isDeleting}
                    className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteSelected}
                    disabled={isDeleting}
                    className="px-3 py-1.5 rounded-md text-sm bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white"
                  >
                    Confirm Delete
                  </button>
                </div>
              </div>
            )}

            {/* Report list */}
            <div className="space-y-3">
              {folderFilteredReports.map((report) => {
                const isSelected = selectedIds.has(report.id);
                const isConfirmingThis = confirmDeleteId === report.id;
                const folder = normFolder(report.folder_path);
                return (
                  <div
                    key={report.id}
                    onClick={() => navigate(`/report/${report.id}`)}
                    draggable
                    onDragStart={(e) => {
                      const ids = isSelected ? Array.from(selectedIds) : [report.id];
                      e.dataTransfer.setData(
                        "application/perfsight-report-ids",
                        JSON.stringify(ids)
                      );
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    className={`bg-white border rounded-lg p-4 transition-colors flex items-center justify-between group cursor-pointer dark:bg-slate-900 ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-600/5 dark:bg-indigo-900/10"
                        : "border-slate-200 hover:border-indigo-500/50 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <button
                        onClick={(e) => toggleSelect(report.id, e)}
                        className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shrink-0"
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
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          Folder: {folder || "Root"}
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

                        {(report.tags?.length ?? 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {report.tags.slice(0, 12).map((t) => (
                              <button
                                key={`tag-${report.id}-${t}`}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if ((e as any).altKey) {
                                    setFilterTags(new Set([t]));
                                    return;
                                  }
                                  setFilterTags((prev) => {
                                    const next = new Set(prev);
                                    for (const existing of next) {
                                      if (existing.toLowerCase() === t.toLowerCase()) {
                                        next.delete(existing);
                                        return next;
                                      }
                                    }
                                    next.add(t);
                                    return next;
                                  });
                                }}
                                className="px-2 py-0.5 rounded-md text-[11px] bg-slate-50 border border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-400 dark:hover:border-slate-600"
                                title="Click to add/remove tag filter. Alt-click to show only this tag."
                              >
                                {t}
                              </button>
                            ))}
                            {report.tags.length > 12 && (
                              <span className="text-[11px] text-slate-600">
                                +{report.tags.length - 12}
                              </span>
                            )}
                          </div>
                        )}

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
                          setMoveModal({
                            ids: [report.id],
                            currentFolder: folder,
                          });
                        }}
                        className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"
                        title="Move to folder"
                      >
                        📁
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/retest/${report.id}`);
                        }}
                        className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                        title="Re-test with this report's configuration"
                      >
                        <RotateCcw className="w-5 h-5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId((cur) =>
                            cur === report.id ? null : report.id
                          );
                        }}
                        className="text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                        title="Delete report"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                );
              })}

              {folderFilteredReports.length === 0 && (
                <div className="text-center text-slate-500 py-10">
                  No reports found.
                  {filterTags.size > 0
                    ? " Try clearing tag filters."
                    : " Run a test to generate one."}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {folderModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (isFolderOp) return;
              setFolderModal(null);
            }}
          />
          <div className="relative w-[520px] max-w-[92vw] bg-white border border-slate-200 rounded-xl shadow-2xl p-5 dark:bg-slate-950 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold">
                {folderModal.kind === "create"
                  ? "Create folder"
                  : folderModal.kind === "rename"
                  ? "Rename folder"
                  : "Delete folder"}
              </div>
              <button
                type="button"
                disabled={isFolderOp}
                onClick={() => setFolderModal(null)}
                className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {folderModal.kind === "create" && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  Parent: <span className="font-mono">{selectedFolder || "Root"}</span>
                </div>
                <input
                  value={folderNameDraft}
                  onChange={(e) => setFolderNameDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="Folder name (e.g. Release_1.2.3)"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isFolderOp}
                    onClick={() => setFolderModal(null)}
                    className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isFolderOp || !folderNameDraft.trim()}
                    onClick={async () => {
                      try {
                        setIsFolderOp(true);
                        const newPath = (await invoke("create_folder", {
                          parentPath: selectedFolder,
                          name: folderNameDraft.trim(),
                        })) as string;
                        setSelectedFolder(normFolder(newPath));
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("create_folder failed", e);
                        alert("Failed to create folder");
                      } finally {
                        setIsFolderOp(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-md text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white"
                  >
                    {isFolderOp ? "Creating…" : "Create"}
                  </button>
                </div>
              </div>
            )}

            {folderModal.kind === "rename" && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  Current:{" "}
                  <span className="font-mono">{folderModal.currentPath}</span>
                </div>
                <input
                  value={folderNameDraft}
                  onChange={(e) => setFolderNameDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="New folder name"
                  autoFocus
                />
                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isFolderOp}
                    onClick={() => setFolderModal(null)}
                    className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isFolderOp || !folderNameDraft.trim()}
                    onClick={async () => {
                      try {
                        setIsFolderOp(true);
                        const newPath = (await invoke("rename_folder", {
                          path: folderModal.currentPath,
                          newName: folderNameDraft.trim(),
                        })) as string;
                        setSelectedFolder(normFolder(newPath));
                        await loadReports();
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("rename_folder failed", e);
                        alert("Failed to rename folder");
                      } finally {
                        setIsFolderOp(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-md text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white"
                  >
                    {isFolderOp ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            )}

            {folderModal.kind === "delete" && (
              <div className="space-y-3">
                <div className="text-xs text-slate-500">
                  Folder: <span className="font-mono">{folderModal.currentPath}</span>
                </div>
                {folderModal.stats ? (
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    Contains{" "}
                    <span className="font-medium tabular-nums">
                      {folderModal.stats.report_count ?? 0}
                    </span>{" "}
                    report(s) and{" "}
                    <span className="font-medium tabular-nums">
                      {folderModal.stats.child_folder_count ?? 0}
                    </span>{" "}
                    subfolder(s).
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">
                    Unable to load folder stats; deletion will require a strategy.
                  </div>
                )}

                {(folderModal.stats?.report_count ?? 1) === 0 &&
                (folderModal.stats?.child_folder_count ?? 1) === 0 ? (
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    This folder is empty and can be deleted safely.
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">
                    Folder is not empty. Choose a strategy to move contents before deletion.
                    <div className="mt-2 flex items-center gap-3">
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="radio"
                          checked={deleteStrategy === "move_to_parent"}
                          onChange={() => setDeleteStrategy("move_to_parent")}
                        />
                        Move contents to parent
                      </label>
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="radio"
                          checked={deleteStrategy === "move_to_root"}
                          onChange={() => setDeleteStrategy("move_to_root")}
                        />
                        Move contents to root
                      </label>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isFolderOp}
                    onClick={() => setFolderModal(null)}
                    className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isFolderOp}
                    onClick={async () => {
                      try {
                        setIsFolderOp(true);
                        const empty =
                          (folderModal.stats?.report_count ?? 0) === 0 &&
                          (folderModal.stats?.child_folder_count ?? 0) === 0;
                        await invoke("delete_folder", {
                          path: folderModal.currentPath,
                          strategy: empty ? null : deleteStrategy,
                        });
                        setSelectedFolder("");
                        await loadReports();
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("delete_folder failed", e);
                        alert("Failed to delete folder");
                      } finally {
                        setIsFolderOp(false);
                      }
                    }}
                    className="px-3 py-1.5 rounded-md text-sm bg-rose-600 hover:bg-rose-500 disabled:opacity-60 text-white"
                  >
                    {isFolderOp ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {moveModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              if (isMoving) return;
              setMoveModal(null);
            }}
          />
          <div className="relative w-[820px] max-w-[92vw] bg-white border border-slate-200 rounded-xl shadow-2xl p-5 dark:bg-slate-950 dark:border-slate-800">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="text-sm font-semibold">Move reports</div>
              <button
                type="button"
                disabled={isMoving}
                onClick={() => setMoveModal(null)}
                className="p-2 rounded-md hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-900 text-slate-600 dark:text-slate-300"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-slate-500 mb-3">
              Moving <span className="font-medium tabular-nums">{moveModal.ids.length}</span>{" "}
              report(s). Pick a destination folder below, then confirm.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                <div className="text-xs text-slate-500 mb-2">Destination</div>
                <div className="text-sm">
                  <span className="text-slate-500">Selected:</span>{" "}
                  <span className="font-mono">{moveModal.currentFolder || "Root"}</span>
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Tip: you can also drag report rows onto a folder in the left tree to move.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                <div className="text-xs text-slate-500 mb-2">Folder tree (pick destination)</div>
                <div className="max-h-[360px] overflow-y-auto custom-scrollbar">
                  {renderFolderNode(tree, 0)}
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Click a folder to set destination (files listed in tree are ignored for destination).
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isMoving}
                onClick={() => setMoveModal(null)}
                className="px-3 py-1.5 rounded-md text-sm bg-slate-200 hover:bg-slate-100 text-slate-900 disabled:opacity-60 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isMoving}
                onClick={async () => {
                  try {
                    setIsMoving(true);
                    await moveIdsToFolder(moveModal.ids, moveModal.currentFolder);
                    setMoveModal(null);
                  } finally {
                    setIsMoving(false);
                  }
                }}
                className="px-3 py-1.5 rounded-md text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white"
              >
                {isMoving ? "Moving…" : "Move"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

