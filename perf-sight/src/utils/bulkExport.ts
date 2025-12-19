import jsPDF from "jspdf";

type AnyReportDetail = {
  id: number;
  created_at: string;
  title: string;
  metrics: any[];
  analysis?: any;
  meta?: any;
};

function percentile(sortedAsc: number[], p: number) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor(p * (sortedAsc.length - 1))));
  return sortedAsc[idx];
}

function avg(arr: number[]) {
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function bytesToMB(b: number | null) {
  if (b == null) return null;
  return b / (1024 * 1024);
}

function safeLinesFromJson(v: any, maxCharsPerLine: number) {
  const raw = JSON.stringify(v ?? {}, null, 2) ?? "{}";
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.length <= maxCharsPerLine) {
      lines.push(line);
      continue;
    }
    // naive wrap
    let i = 0;
    while (i < line.length) {
      lines.push(line.slice(i, i + maxCharsPerLine));
      i += maxCharsPerLine;
    }
  }
  return lines;
}

export async function buildReportPdfDataUri(report: AnyReportDetail): Promise<string> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 44;
  const maxW = pageW - margin * 2;
  const lineH = 14;

  const ensureSpace = (needed: number) => {
    if (y + needed <= pageH - margin) return;
    doc.addPage();
    y = margin;
  };

  const addHeading = (t: string) => {
    ensureSpace(24);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(t, margin, y);
    y += 18;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
  };

  const addKV = (k: string, v: string) => {
    const txt = `${k}: ${v}`;
    const lines = doc.splitTextToSize(txt, maxW);
    ensureSpace(lines.length * lineH + 6);
    doc.text(lines, margin, y);
    y += lines.length * lineH + 6;
  };

  const addLines = (lines: string[]) => {
    for (const l of lines) {
      const parts = doc.splitTextToSize(l, maxW);
      ensureSpace(parts.length * lineH);
      doc.text(parts, margin, y);
      y += parts.length * lineH;
    }
    y += 6;
  };

  let y = margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(report.title || `Report ${report.id}`, margin, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  addKV("Report ID", String(report.id));
  addKV("Created at", report.created_at || "");

  // Quick summary from metrics (best-effort)
  const byPid: Map<number, { cpu: number[]; memBytes: number[] }> = new Map();
  for (const batch of report.metrics || []) {
    const metrics = batch?.metrics || {};
    for (const pidStr of Object.keys(metrics)) {
      const pid = Number(pidStr);
      const p = metrics[pidStr];
      const cpu =
        (typeof p?.cpu_chrome_usage === "number" ? p.cpu_chrome_usage : null) ??
        (typeof p?.cpu_os_usage === "number" ? p.cpu_os_usage : null) ??
        (typeof p?.cpu_usage === "number" ? p.cpu_usage : null);
      const mem =
        (typeof p?.memory_private === "number" ? p.memory_private : null) ??
        (typeof p?.memory_footprint === "number" ? p.memory_footprint : null) ??
        (typeof p?.memory_rss === "number" ? p.memory_rss : null);
      if (!byPid.has(pid)) byPid.set(pid, { cpu: [], memBytes: [] });
      if (typeof cpu === "number" && Number.isFinite(cpu)) byPid.get(pid)!.cpu.push(cpu);
      if (typeof mem === "number" && Number.isFinite(mem)) byPid.get(pid)!.memBytes.push(mem);
    }
  }

  if (byPid.size) {
    addHeading("Per-process summary (from dataset)");
    const pids = Array.from(byPid.keys()).sort((a, b) => a - b);
    for (const pid of pids) {
      const s = byPid.get(pid)!;
      const cpuSorted = [...s.cpu].sort((a, b) => a - b);
      const memSorted = [...s.memBytes].sort((a, b) => a - b);
      const cpuAvg = avg(s.cpu);
      const cpuP95 = percentile(cpuSorted, 0.95);
      const memAvg = bytesToMB(avg(s.memBytes) ?? null);
      const memP95 = bytesToMB(percentile(memSorted, 0.95));
      addKV(
        `PID ${pid}`,
        `CPU avg=${cpuAvg == null ? "n/a" : cpuAvg.toFixed(2)}%  P95=${cpuP95 == null ? "n/a" : cpuP95.toFixed(2)}%  |  Mem avg=${memAvg == null ? "n/a" : memAvg.toFixed(1)}MB  P95=${memP95 == null ? "n/a" : memP95.toFixed(1)}MB`
      );
    }
  }

  addHeading("Metadata (full)");
  addLines(safeLinesFromJson(report.meta ?? {}, 120));

  if (report.analysis) {
    addHeading("Analysis (full)");
    addLines(safeLinesFromJson(report.analysis, 120));
  }

  return doc.output("datauristring");
}


