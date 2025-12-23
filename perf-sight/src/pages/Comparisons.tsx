import React, { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useNavigate } from "react-router-dom";
import {
  GitCompare,
  FolderPlus,
  Folder,
  Pencil,
  Trash,
  File,
  X,
  CheckSquare,
  Square,
  Download,
  Upload,
} from "lucide-react";

interface ComparisonSummary {
  id: number;
  created_at: string;
  title: string;
  folder_path?: string;
  tags?: string[];
  report_count: number;
}

interface FolderInfo {
  path: string; // "" means root
}

interface FolderStats {
  path: string;
  comparison_count: number;
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

export const Comparisons: React.FC = () => {
  const navigate = useNavigate();

  const [items, setItems] = useState<ComparisonSummary[]>([]);
  const [folders, setFolders] = useState<FolderInfo[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string>(""); // "" root
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const [isImporting, setIsImporting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

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

  const loadComparisons = async () => {
    const data = (await invoke("get_comparisons")) as any;
    setItems(data || []);
  };

  const loadFolders = async () => {
    try {
      const data = (await invoke("list_comparison_folder_paths")) as FolderInfo[];
      setFolders(data || []);
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add("");
        return next;
      });
    } catch (e) {
      console.warn("list_comparison_folder_paths failed", e);
      setFolders([{ path: "" }]);
    }
  };

  useEffect(() => {
    loadComparisons().catch(console.error);
    loadFolders().catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    const folder = normFolder(selectedFolder);
    if (!folder) return items;
    return items.filter((c) => normFolder(c.folder_path) === folder);
  }, [items, selectedFolder]);

  const itemsByFolder = useMemo(() => {
    const m = new Map<string, ComparisonSummary[]>();
    for (const c of items) {
      const fp = normFolder(c.folder_path);
      if (!m.has(fp)) m.set(fp, []);
      m.get(fp)!.push(c);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => b.id - a.id);
    }
    return m;
  }, [items]);

  const tree: FolderNode = useMemo(() => {
    const all = new Set<string>((folders || []).map((f) => normFolder(f.path)));
    all.add("");
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
      byPath.set(p, { path: p, name, children: [] });
    }
    for (const [p, node] of byPath.entries()) {
      if (p === "") continue;
      const parent = p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
      (byPath.get(parent) || root).children.push(node);
    }
    const sortRec = (n: FolderNode) => {
      n.children.sort((a, b) => a.name.localeCompare(b.name));
      n.children.forEach(sortRec);
    };
    sortRec(root);
    return root;
  }, [folders]);

  const toggleSelect = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const moveIdsToFolder = async (ids: number[], folderPath: string) => {
    const path = folderPath.trim();
    try {
      setIsMoving(true);
      if (ids.length === 1) {
        await invoke("update_comparison_folder_path", {
          id: ids[0],
          folderPath: path,
        } as any);
      } else {
        await invoke("update_comparisons_folder_path", {
          ids,
          folderPath: path,
        } as any);
      }
      await loadComparisons();
      await loadFolders();
    } finally {
      setIsMoving(false);
    }
  };

  const renderFolderNode = (n: FolderNode, depth: number) => {
    const isExpanded = expanded.has(n.path);
    const isSelected = selectedFolder === n.path;
    const files = itemsByFolder.get(n.path) ?? [];
    const hasExpandable = n.children.length > 0 || files.length > 0;

    return (
      <div key={`cf_${n.path || "root"}`}>
        <button
          type="button"
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            try {
              const raw = e.dataTransfer.getData(
                "application/perfsight-comparison-ids"
              );
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
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(n.path)) next.delete(n.path);
              else next.add(n.path);
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
            {files.slice(0, 50).map((c) => {
              const isRowSelected = selectedIds.has(c.id);
              return (
                <button
                  key={`cfile_${n.path}_${c.id}`}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    const ids = isRowSelected
                      ? Array.from(selectedIds)
                      : [c.id];
                    e.dataTransfer.setData(
                      "application/perfsight-comparison-ids",
                      JSON.stringify(ids)
                    );
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/comparison/${c.id}`, {
                      state: { fromComparisons: true },
                    });
                  }}
                  className={`w-full text-left px-2 py-1 rounded-md flex items-center gap-2 transition-colors ${
                    isRowSelected
                      ? "bg-indigo-600/10 text-indigo-700 dark:bg-indigo-600/20 dark:text-indigo-200"
                      : "hover:bg-slate-100 text-slate-700 dark:hover:bg-slate-900 dark:text-slate-300"
                  }`}
                  style={{ paddingLeft: 26 + (depth + 1) * 14 }}
                  title={c.title}
                >
                  <File className="w-4 h-4 text-slate-500" />
                  <span className="truncate">{c.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
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
      const stats = (await invoke("get_comparison_folder_stats", {
        path: selectedFolder,
      })) as FolderStats;
      setDeleteStrategy("move_to_parent");
      setFolderModal({ kind: "delete", currentPath: selectedFolder, stats });
    } catch (e) {
      console.error("get_comparison_folder_stats failed", e);
      setFolderModal({ kind: "delete", currentPath: selectedFolder, stats: null });
    }
  };

  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Delete ${selectedIds.size} comparison(s)? This cannot be undone.`)) return;
    await invoke("delete_comparisons", { ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    await loadComparisons();
  };

  const handleExportSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length !== 1) {
      alert("Please select exactly 1 comparison to export.");
      return;
    }
    try {
      setIsExporting(true);
      const outPath = (await invoke("export_comparison_bundle_json", {
        comparisonId: ids[0],
        filename: null,
      } as any)) as string;
      alert(`Exported:\n${outPath}`);
    } finally {
      setIsExporting(false);
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
                <GitCompare className="w-4 h-4 text-indigo-600 dark:text-indigo-500" />
                Comparisons
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
              Folder: {selectedFolder || "Root"}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
            {renderFolderNode(tree, 0)}
          </div>
        </div>

        {/* Right: List + bulk actions */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <div className="p-6 max-w-6xl mx-auto">
            <div className="flex items-center justify-between gap-4 flex-wrap mb-4">
              <div className="flex items-center gap-3">
                <div className="text-lg font-bold">Comparisons</div>
                <div className="text-xs text-slate-500">
                  {filtered.length} item(s)
                </div>
              </div>

              <div className="flex items-center gap-3">
                <label className="bg-slate-900 hover:bg-slate-800 text-white px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors dark:bg-slate-800 dark:hover:bg-slate-700">
                  {isImporting ? "Importing…" : "Import Comparison"}
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
                        const result = (await invoke("import_comparison_bundle", {
                          bundleJson: text,
                        })) as any;
                        await loadComparisons();
                        await loadFolders();
                        if (result?.comparison_id) {
                          navigate(`/comparison/${result.comparison_id}`, {
                            state: { fromComparisons: true },
                          });
                        } else {
                          alert("Imported, but no comparison_id returned.");
                        }
                      } catch (err) {
                        console.error("Import failed", err);
                        alert("Failed to import comparison.");
                      } finally {
                        setIsImporting(false);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

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
                  title="Move selected comparisons to a folder"
                >
                  Move…
                </button>
                <button
                  onClick={handleExportSelected}
                  disabled={isExporting}
                  className="bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors dark:bg-slate-800 dark:hover:bg-slate-700"
                  title="Export selected comparison (1 only)"
                >
                  <Download className="w-4 h-4" />
                  {isExporting ? "Exporting…" : "Export…"}
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="bg-rose-600 hover:bg-rose-500 text-white px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  <Trash className="w-4 h-4" /> Delete
                </button>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                >
                  Clear selection
                </button>
              </div>
            )}

            {/* List */}
            <div className="space-y-3">
              {filtered.map((c) => {
                const isSelected = selectedIds.has(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() =>
                      navigate(`/comparison/${c.id}`, {
                        state: { fromComparisons: true },
                      })
                    }
                    className={`bg-white border rounded-lg p-4 transition-colors flex items-center justify-between group cursor-pointer dark:bg-slate-900 ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-600/5 dark:bg-indigo-900/10"
                        : "border-slate-200 hover:border-indigo-500/50 dark:border-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-4 min-w-0">
                      <button
                        onClick={(e) => toggleSelect(c.id, e)}
                        className="text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors shrink-0"
                        title="Select"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-indigo-500" />
                        ) : (
                          <Square className="w-5 h-5" />
                        )}
                      </button>
                      <div className="min-w-0">
                        <div className="font-medium text-lg truncate">
                          {c.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 truncate">
                          Folder: {normFolder(c.folder_path) || "Root"} ·{" "}
                          {c.report_count} reports
                        </div>
                        {(c.tags?.length ?? 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {(c.tags || []).slice(0, 12).map((t) => (
                              <span
                                key={`tag-${c.id}-${t}`}
                                className="px-2 py-0.5 rounded-md text-[11px] bg-slate-50 border border-slate-200 text-slate-600 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-400"
                              >
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
              {filtered.length === 0 && (
                <div className="text-center text-slate-500 py-10">
                  No comparisons found.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Folder modal */}
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
                  Parent:{" "}
                  <span className="font-mono">{selectedFolder || "Root"}</span>
                </div>
                <input
                  value={folderNameDraft}
                  onChange={(e) => setFolderNameDraft(e.target.value)}
                  className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 dark:bg-slate-950 dark:border-slate-800 dark:text-slate-200 dark:placeholder:text-slate-600"
                  placeholder="Folder name"
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
                        const newPath = (await invoke("create_comparison_folder", {
                          parentPath: selectedFolder,
                          name: folderNameDraft.trim(),
                        } as any)) as string;
                        setSelectedFolder(normFolder(newPath));
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("create_comparison_folder failed", e);
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
                        const newPath = (await invoke("rename_comparison_folder", {
                          path: folderModal.currentPath,
                          newName: folderNameDraft.trim(),
                        } as any)) as string;
                        setSelectedFolder(normFolder(newPath));
                        await loadComparisons();
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("rename_comparison_folder failed", e);
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
                  Folder:{" "}
                  <span className="font-mono">{folderModal.currentPath}</span>
                </div>

                {folderModal.stats ? (
                  <div className="text-sm text-slate-700 dark:text-slate-300">
                    Contains{" "}
                    <span className="font-medium tabular-nums">
                      {folderModal.stats.comparison_count ?? 0}
                    </span>{" "}
                    comparison(s) and{" "}
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

                {(folderModal.stats?.comparison_count ?? 1) === 0 &&
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
                          (folderModal.stats?.comparison_count ?? 0) === 0 &&
                          (folderModal.stats?.child_folder_count ?? 0) === 0;
                        await invoke("delete_comparison_folder", {
                          path: folderModal.currentPath,
                          strategy: empty ? null : deleteStrategy,
                        } as any);
                        setSelectedFolder("");
                        await loadComparisons();
                        await loadFolders();
                        setFolderModal(null);
                      } catch (e) {
                        console.error("delete_comparison_folder failed", e);
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

      {/* Move modal */}
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
              <div className="text-sm font-semibold">Move comparisons</div>
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
              Moving{" "}
              <span className="font-medium tabular-nums">{moveModal.ids.length}</span>{" "}
              comparison(s). Pick a destination folder below, then confirm.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                <div className="text-xs text-slate-500 mb-2">Destination</div>
                <div className="text-sm">
                  <span className="text-slate-500">Selected:</span>{" "}
                  <span className="font-mono">{moveModal.currentFolder || "Root"}</span>
                </div>
                <div className="mt-2 text-[11px] text-slate-500">
                  Tip: you can also drag rows onto a folder in the left tree to move.
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/20">
                <div className="text-xs text-slate-500 mb-2">
                  Folder tree (pick destination)
                </div>
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


