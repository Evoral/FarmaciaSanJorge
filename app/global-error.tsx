"use client";

/**
 * Last-resort error boundary (errors in the root layout itself): replaces
 * the root layout, so it renders its own `<html>`/`<body>`. Fixed Spanish
 * copy, never the raw error message.
 */
import "./globals.css";

export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="es">
      <body className="min-h-full flex flex-col">
        <title>Error — Farmacia San Jorge</title>
        <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-12">
          <h1 className="text-2xl font-semibold">Algo salió mal</h1>
          <p className="text-zinc-600">
            No se pudo cargar la aplicación. Volvé a intentarlo; si el problema persiste, contactá al administrador.
          </p>
          {error.digest ? <p className="text-xs text-zinc-500">Referencia para soporte: {error.digest}</p> : null}
          <div>
            <button type="button" className="btn btn-primary" onClick={() => retry()}>
              Reintentar
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
