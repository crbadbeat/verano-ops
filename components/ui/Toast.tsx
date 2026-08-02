"use client";

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

// -----------------------------------------------------------------------------
// App-wide toast notifications. Mount <ToastProvider> once (root layout); call
// useToast()(message) from any client component, or drop a <ToastOnParam> on a
// page that a server action redirects to with a success query param.
// -----------------------------------------------------------------------------

type Tone = "success" | "error";
interface Toast {
  id: number;
  message: string;
  tone: Tone;
}

const ToastCtx = createContext<(message: string, tone?: Tone) => void>(() => {});

/** Fire a toast: `const toast = useToast(); toast("Saved");` */
export function useToast() {
  return useContext(ToastCtx);
}

const TONE_COLOR: Record<Tone, string> = {
  success: "var(--success)",
  error: "var(--danger)",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const show = useCallback((message: string, tone: Tone = "success") => {
    const id = (idRef.current += 1);
    setToasts((cur) => [...cur, { id, message, tone }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 3500);
  }, []);

  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="toast-in pointer-events-auto card px-4 py-3 shadow-2xl flex items-center gap-2.5 max-w-sm"
            style={{ borderLeft: `3px solid ${TONE_COLOR[t.tone]}` }}
          >
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke={TONE_COLOR[t.tone]}
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              {t.tone === "success" ? <path d="M20 6 9 17l-5-5" /> : <><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6M9 9l6 6" /></>}
            </svg>
            <span className="text-sm">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
