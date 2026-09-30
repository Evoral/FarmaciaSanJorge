"use client";

/**
 * Error boundary for every authenticated route: an unexpected error while
 * rendering a page must never show Next's default English screen. The
 * message is fixed Spanish (in production `error.message` from a Server
 * Component is already a generic placeholder, and must not be shown
 * anyway); `digest` correlates with the server log line.
 */
import Link from "next/link";

export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
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
        <Link href="/" className="btn btn-secondary">
          Ir al inicio
        </Link>
      </div>
    </main>
  );
}
