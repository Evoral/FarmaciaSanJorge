"use client";

/**
 * Transient feedback ("Se copiaron 3 números"). Call `toast()` from any
 * client component; mount ONE `<Toaster />` per page. Toasts are for
 * transient confirmations only: errors that need action stay inline.
 * Announced politely; auto-dismiss after 4 s (paused while hovered).
 */
import { AlertCircle, CheckCircle2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type ToastTone = "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

const DURATION_MS = 4000;
const listeners = new Set<(item: ToastItem) => void>();
let nextId = 1;

export function toast(message: string, tone: ToastTone = "success") {
  const item = { id: nextId++, message, tone };
  for (const listener of listeners) listener(item);
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const add = (item: ToastItem) => setItems((current) => [...current.slice(-2), item]);
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);

  return (
    <div className="toast-region" role="status" aria-live="polite">
      {items.map((item) => (
        <Toast key={item.id} item={item} onDismiss={dismiss} />
      ))}
    </div>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onDismiss(item.id), DURATION_MS);
  }, [item.id, onDismiss]);

  useEffect(() => {
    start();
    return () => clearTimeout(timer.current);
  }, [start]);

  const Icon = item.tone === "error" ? AlertCircle : CheckCircle2;
  return (
    <div className="toast" data-tone={item.tone} onMouseEnter={() => clearTimeout(timer.current)} onMouseLeave={start}>
      <Icon aria-hidden />
      <span className="min-w-0 flex-1">{item.message}</span>
      <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => onDismiss(item.id)} aria-label="Cerrar aviso">
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
