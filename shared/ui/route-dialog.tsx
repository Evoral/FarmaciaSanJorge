"use client";

/**
 * Modal shell for an intercepted route (`@slot/(.)segment/page.tsx`): the route renders over the page it was opened
 * from, and closing it is a `router.back()` (so the browser's back button closes it too). Same native `<dialog>` +
 * `showModal()` approach as modules/preparaciones/ui/ver-receta-pendiente-dialog.tsx: focus trap, Escape and the
 * backdrop click come from the browser. Forms inside call `useRouteDialogClose()` to close it after a success; outside
 * a dialog (the same content rendered as a full page) the hook returns `undefined`.
 */
import { createContext, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";

const RouteDialogContext = createContext<(() => void) | undefined>(undefined);

export function useRouteDialogClose(): (() => void) | undefined {
  return useContext(RouteDialogContext);
}

export interface RouteDialogProps {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
}

export function RouteDialog({ title, subtitle, children }: RouteDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cerrandoRef = useRef(false);
  const tituloId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  function cerrar() {
    if (cerrandoRef.current) return;
    cerrandoRef.current = true;
    router.back();
  }

  return (
    <RouteDialogContext.Provider value={cerrar}>
      <dialog
        ref={dialogRef}
        aria-labelledby={tituloId}
        // Escape closes the native dialog; the route must follow.
        onClose={cerrar}
        // The content wrapper fills the dialog, so a click whose target is the dialog itself landed on the backdrop.
        onClick={(event) => {
          if (event.target === event.currentTarget) cerrar();
        }}
        className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id={tituloId} className="text-lg font-semibold">
                {title}
              </h2>
              {subtitle ? <p className="truncate text-sm text-zinc-500">{subtitle}</p> : null}
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
              <X className="size-4" aria-hidden />
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </RouteDialogContext.Provider>
  );
}
