import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Server, Settings as SettingsIcon } from "lucide-react";
import { getServerSyncConfig, saveServerSyncConfig } from "../utils/serverSync";
import { useNotifications } from "../components/Notifications";

export const SettingsPage: React.FC = () => {
  const { pushNotification } = useNotifications();
  const [serverUrl, setServerUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getServerSyncConfig()
      .then((config) => {
        if (active) setServerUrl(config.serverUrl);
      })
      .catch(() => {
        if (active) setError("Could not load Server settings.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await saveServerSyncConfig(serverUrl);
      setServerUrl(saved.serverUrl);
      pushNotification("Server settings saved", `Reports will upload to ${saved.serverUrl} after a test is stopped.`, "success");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not save Server settings.";
      setError(message);
      pushNotification("Could not save Server settings", message, "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-slate-50 dark:bg-slate-950">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-6 py-4 dark:border-slate-800 dark:bg-slate-900">
        <Link to="/" aria-label="Back to Dashboard" title="Back to Dashboard" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-white">
          <SettingsIcon className="h-4 w-4" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Settings</h1>
          <p className="text-xs text-slate-500">Configure where PerfSight sends reports.</p>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto p-6">
        <form onSubmit={handleSave} className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-400">
              <Server className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Central PerfSight Server</h2>
              <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                Completed reports are uploaded automatically when you stop a test. Use the HTTPS address of your Server.
              </p>

              <label htmlFor="server-url" className="mt-6 block text-sm font-medium text-slate-700 dark:text-slate-300">Server URL</label>
              <input
                id="server-url"
                type="url"
                value={serverUrl}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  setError("");
                }}
                disabled={loading || saving}
                placeholder="https://perfsight.example.com"
                autoComplete="url"
                className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100 dark:focus:ring-indigo-950"
              />
              {error && <div role="alert" className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</div>}

              <div className="mt-6 flex items-center justify-between gap-3">
                {serverUrl && !loading && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Server configured
                  </span>
                )}
                <button
                  type="submit"
                  disabled={loading || saving}
                  className="ml-auto inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-wait disabled:opacity-60"
                >
                  {loading ? "Loading…" : saving ? "Saving…" : "Save Server URL"}
                </button>
              </div>
            </div>
          </div>
        </form>
      </main>
    </div>
  );
};
