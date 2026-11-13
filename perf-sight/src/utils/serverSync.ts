import { invoke } from "@tauri-apps/api/core";

export interface ServerSyncConfig {
  serverUrl: string;
}

export interface ReportUploadInput {
  id: number;
  created_at: string;
  title: string;
  metrics: unknown[];
  analysis?: unknown;
  meta?: Record<string, unknown> | null;
}

export interface StopAndSyncResult {
  saved: boolean;
  reportId?: number;
  uploaded?: boolean;
  serverRunId?: string;
  uploadError?: string;
}

const SERVER_URL_KEY = "perfsight_server_url";
const CLIENT_ID_KEY = "perfsight_client_id";
const CLIENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getServerSyncConfig(): Promise<ServerSyncConfig> {
  // Remove credentials written by older client versions now that this Server is open-access.
  localStorage.removeItem("perfsight_api_token");
  return { serverUrl: localStorage.getItem(SERVER_URL_KEY) || "" };
}

export async function saveServerSyncConfig(serverUrl: string): Promise<ServerSyncConfig> {
  const normalizedUrl = normalizeServerUrl(serverUrl);
  localStorage.setItem(SERVER_URL_KEY, normalizedUrl);
  localStorage.removeItem("perfsight_api_token");
  return { serverUrl: normalizedUrl };
}

export function normalizeServerUrl(rawUrl: string): string {
  const value = rawUrl.trim();
  if (!value) throw new Error("Enter the PerfSight Server URL.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a valid PerfSight Server URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Use an HTTPS URL for the PerfSight Server.");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("The Server URL must not contain credentials, query parameters, or a fragment.");
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, "");
}

function getClientId(): string {
  const existing = localStorage.getItem(CLIENT_ID_KEY);
  if (existing && CLIENT_ID_PATTERN.test(existing)) return existing;

  const id = globalThis.crypto.randomUUID();
  localStorage.setItem(CLIENT_ID_KEY, id);
  return id;
}

function sanitizeProcessSnapshot(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 512).flatMap((entry) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return [];
    const process = entry as Record<string, unknown>;
    if (typeof process.pid !== "number" || !Number.isSafeInteger(process.pid) || process.pid < 0) return [];
    const safeLabel = (label: unknown, maxLength: number) => typeof label === "string"
      ? label.slice(0, maxLength * 2).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, maxLength)
      : undefined;
    return [{
      pid: process.pid,
      name: safeLabel(process.name, 120),
      alias: safeLabel(process.alias, 120),
      proc_type: safeLabel(process.proc_type, 40),
    }];
  });
}

export async function uploadReportDataset(
  report: ReportUploadInput,
  config?: ServerSyncConfig,
): Promise<{ run?: { id?: string; title?: string }; duplicate?: boolean }> {
  const resolvedConfig = config ?? await getServerSyncConfig();
  const serverUrl = normalizeServerUrl(resolvedConfig.serverUrl);

  const currentMeta = report.meta && typeof report.meta === "object" && !Array.isArray(report.meta)
    ? report.meta
    : {};
  const source = currentMeta.source && typeof currentMeta.source === "object" && !Array.isArray(currentMeta.source)
    ? currentMeta.source as Record<string, unknown>
    : {};
  const uploadMeta = { ...currentMeta };
  if ("process_snapshot" in uploadMeta) {
    // Window titles and URLs can include user content and are not needed for aggregate analysis.
    uploadMeta.process_snapshot = sanitizeProcessSnapshot(uploadMeta.process_snapshot);
  }
  const enrichedReport = {
    ...report,
    meta: {
      ...uploadMeta,
      source: {
        ...source,
        client_id: getClientId(),
        client_type: "perfsight-desktop",
      },
    },
  };

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 30_000);
  let response: Response;
  try {
    response = await fetch(`${serverUrl}/api/v1/datasets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        schema_version: 1,
        exported_at: new Date().toISOString(),
        report: enrichedReport,
      }),
      signal: controller.signal,
      redirect: "error",
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Server upload timed out after 30 seconds.");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof result.error === "string" ? result.error : `Upload failed (${response.status}).`;
    throw new Error(message);
  }
  return result;
}

export async function uploadLocalReport(reportId: number, config?: ServerSyncConfig) {
  const report = await invoke<ReportUploadInput>("get_report_detail", { id: reportId });
  return uploadReportDataset(report, config);
}

export async function stopCollectionAndSyncReport(): Promise<StopAndSyncResult> {
  const stopResult = await invoke<string>("stop_collection");
  if (stopResult !== "Stopped and Saved Report") return { saved: false };

  let reports: Array<{ id: number }>;
  try {
    reports = await invoke<Array<{ id: number }>>("get_reports");
  } catch {
    return { saved: true, uploadError: "Report was saved locally, but its ID could not be loaded." };
  }
  const reportId = reports[0]?.id;
  if (typeof reportId !== "number" || !Number.isSafeInteger(reportId) || reportId < 1) {
    return { saved: true, uploadError: "Report was saved locally, but its ID could not be loaded." };
  }

  try {
    const config = await getServerSyncConfig();
    if (!config.serverUrl) return { saved: true, reportId };
    const response = await uploadLocalReport(reportId, config);
    return {
      saved: true,
      reportId,
      uploaded: true,
      serverRunId: response.run?.id,
    };
  } catch (error) {
    const uploadError = error instanceof Error ? error.message : "Server upload failed.";
    return { saved: true, reportId, uploaded: false, uploadError };
  }
}
