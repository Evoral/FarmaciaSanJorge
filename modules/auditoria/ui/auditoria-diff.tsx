/**
 * Renders `valorAnterior` -> `valorNuevo` for one `registro_auditoria` row
 * (M03, FASE 3 point 3.11). Both values are arbitrary `Json | null` from
 * Prisma -- primitives, objects, arrays, or `null`, entirely
 * attacker/user-influenced content that ends up here as JSON.
 *
 * SECURITY (task-mandated, non-negotiable): everything is rendered as
 * escaped TEXT. React JSX text content (`{...}` inside an element) is
 * escaped by default, so `String(value)` / `JSON.stringify(value, null, 2)`
 * placed as children is safe -- this file NEVER opts into raw/unescaped
 * HTML injection for a value coming from this data, and NEVER passes a
 * JSON value into an `href`, inline `style`, or anything else that could
 * be interpreted as markup/URL/CSS. This is checked by this task's own
 * final grep for the raw-HTML-injection prop name across this module and
 * its route, which must return nothing.
 */
function formatValor(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function ValorBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {formatValor(value)}
      </pre>
    </div>
  );
}

export interface AuditoriaDiffProps {
  valorAnterior: unknown;
  valorNuevo: unknown;
}

/** Side-by-side "anterior -> nuevo" diff block. Pure presentational, no client JS needed. */
export function AuditoriaDiff({ valorAnterior, valorNuevo }: AuditoriaDiffProps) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      <ValorBlock label="Valor anterior" value={valorAnterior} />
      <ValorBlock label="Valor nuevo" value={valorNuevo} />
    </div>
  );
}
