import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertCircle, CheckCircle2, Info, MessageSquareText, Trash2, X } from "lucide-react";

export type NotificationKind = "success" | "error" | "info";

interface NotificationAction {
  label: string;
  onClick: () => void;
}

interface AppNotification {
  id: string;
  title: string;
  message: string;
  kind: NotificationKind;
  createdAt: number;
  read: boolean;
  action?: NotificationAction;
}

interface ToastNotification extends AppNotification {}

interface NotificationContextValue {
  notifications: AppNotification[];
  unreadCount: number;
  pushNotification: (title: string, message: string, kind?: NotificationKind, action?: NotificationAction) => void;
  markAllRead: () => void;
  clearNotifications: () => void;
  dismissToast: (id: string) => void;
  toasts: ToastNotification[];
}

const NotificationContext = createContext<NotificationContextValue | null>(null);

export const useNotifications = () => {
  const value = useContext(NotificationContext);
  if (!value) throw new Error("useNotifications must be used inside NotificationProvider.");
  return value;
};

export const NotificationProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  const toastTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismissToast = useCallback((id: string) => {
    const timer = toastTimers.current.get(id);
    if (timer) clearTimeout(timer);
    toastTimers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushNotification = useCallback((title: string, message: string, kind: NotificationKind = "info", action?: NotificationAction) => {
    const id = `${Date.now()}-${nextId.current++}`;
    const item: AppNotification = {
      id,
      title: title.trim().slice(0, 120) || "PerfSight",
      message: message.trim().slice(0, 1000),
      kind,
      createdAt: Date.now(),
      read: false,
      action,
    };
    setNotifications((current) => [item, ...current].slice(0, 100));
    setToasts((current) => [...current, item].slice(-4));
    const timer = setTimeout(() => dismissToast(id), 4500);
    toastTimers.current.set(id, timer);
  }, [dismissToast]);

  const markAllRead = useCallback(() => {
    setNotifications((current) => current.map((item) => item.read ? item : { ...item, read: true }));
  }, []);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  useEffect(() => () => {
    toastTimers.current.forEach((timer) => clearTimeout(timer));
    toastTimers.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<unknown>("perfsight-notification", (event) => {
      if (!active || typeof event.payload !== "object" || event.payload === null || Array.isArray(event.payload)) return;
      const payload = event.payload as Record<string, unknown>;
      if (typeof payload.title !== "string" || typeof payload.message !== "string") return;
      const kind = payload.kind === "success" || payload.kind === "error" ? payload.kind : "info";
      pushNotification(payload.title, payload.message, kind);
    }).then((stopListening) => {
      if (active) unlisten = stopListening;
      else stopListening();
    }).catch(() => {
      // The event bridge is available only in the Tauri desktop runtime.
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [pushNotification]);

  const value = useMemo(() => ({
    notifications,
    unreadCount: notifications.reduce((count, item) => count + (item.read ? 0 : 1), 0),
    pushNotification,
    markAllRead,
    clearNotifications,
    dismissToast,
    toasts,
  }), [notifications, pushNotification, markAllRead, clearNotifications, dismissToast, toasts]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <ToastViewport />
    </NotificationContext.Provider>
  );
};

const kindStyles: Record<NotificationKind, { icon: React.ReactNode; accent: string }> = {
  success: { icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, accent: "border-l-emerald-500" },
  error: { icon: <AlertCircle className="h-4 w-4 text-rose-500" />, accent: "border-l-rose-500" },
  info: { icon: <Info className="h-4 w-4 text-indigo-500" />, accent: "border-l-indigo-500" },
};

export const NotificationCenter: React.FC = () => {
  const { notifications, unreadCount, markAllRead, clearNotifications } = useNotifications();
  const [open, setOpen] = useState(false);

  const toggleOpen = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen) markAllRead();
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleOpen}
        aria-label={unreadCount ? `Messages, ${unreadCount} unread` : "Messages"}
        aria-expanded={open}
        title="System messages"
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100"
      >
        <MessageSquareText className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <button className="fixed inset-0 z-40 cursor-default" aria-label="Close messages" onClick={() => setOpen(false)} />
          <section className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
              <div>
                <h2 className="text-sm font-semibold">System messages</h2>
                <p className="text-[11px] text-slate-500">Recent PerfSight events</p>
              </div>
              <div className="flex items-center gap-1">
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={clearNotifications}
                    title="Clear messages"
                    className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button type="button" onClick={() => setOpen(false)} aria-label="Close messages" className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </header>
            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-xs text-slate-400">No system messages yet.</div>
              ) : notifications.map((item) => (
                <article key={item.id} className="flex gap-2.5 border-b border-slate-100 px-4 py-3 last:border-0 dark:border-slate-800">
                  <div className="mt-0.5 shrink-0">{kindStyles[item.kind].icon}</div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-slate-800 dark:text-slate-100">{item.title}</div>
                    <p className="mt-0.5 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{item.message}</p>
                    <time className="mt-1 block text-[10px] text-slate-400" dateTime={new Date(item.createdAt).toISOString()}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                    {item.action && (
                      <button type="button" onClick={item.action.onClick} className="mt-2 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950">
                        {item.action.label}
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const ToastViewport: React.FC = () => {
  const { toasts, dismissToast } = useNotifications();
  if (!toasts.length) return null;
  return (
    <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed right-4 top-4 z-[100] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} role={toast.kind === "error" ? "alert" : "status"} className={`pointer-events-auto flex gap-3 rounded-xl border border-slate-200 border-l-4 bg-white p-3 shadow-lg dark:border-slate-700 dark:bg-slate-900 ${kindStyles[toast.kind].accent}`}>
          <div className="mt-0.5 shrink-0">{kindStyles[toast.kind].icon}</div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{toast.title}</div>
            <p className="mt-0.5 break-words text-xs leading-5 text-slate-500 dark:text-slate-400">{toast.message}</p>
            {toast.action && (
              <button type="button" onClick={toast.action.onClick} className="mt-2 rounded-md bg-indigo-50 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:text-indigo-300 dark:hover:bg-indigo-950">
                {toast.action.label}
              </button>
            )}
          </div>
          <button type="button" onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification" className="h-fit rounded-md p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
