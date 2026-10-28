"use client";

import { useEffect } from "react";
import { verificarSesionAction } from "./sesion-actions";

/**
 * Error boundary for every authenticated route: an unexpected error while
 * rendering a page must never show Next's default English screen. The
 * message is fixed Spanish (in production `error.message` from a Server
 * Component is already a generic placeholder, and must not be shown
 * anyway); `digest` correlates with the server log line.
 *
 * The usual cause on a client navigation is an expired session: the shared layout (which redirects to /login) does not
 * re-render on a soft navigation, so the page's own `requireSession()` throws here. The message is redacted in
 * production, so ask the server; with no session, go straight to /login.
 */

/**
 * A hard load on purpose: it re-runs app/(app)/layout.tsx, which sends a session with a pending step to its page.
 * A soft navigation (`router.push`) would hit the same server-component error again.
 */
function irAlInicio() {
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/");
}

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    verificarSesionAction()
      .then((vigente) => {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (!vigente) window.location.assign("/login");
      })
      .catch(() => {});
  }, [error]);

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 py-12">
      <h1 className="text-2xl font-semibold">Algo salió mal</h1>
      <p className="text-zinc-600">
        No se pudo mostrar esta página. Volvé a intentarlo; si el problema persiste, contactá al administrador.
      </p>
      {error.digest ? <p className="text-xs text-zinc-500">Referencia para soporte: {error.digest}</p> : null}
      <div className="flex gap-3">
        <button type="button" className="btn btn-primary" onClick={() => retry()}>
          Reintentar
        </button>
        <button type="button" className="btn btn-secondary" onClick={irAlInicio}>
          Ir al inicio
        </button>
      </div>
    </main>
  );
}
