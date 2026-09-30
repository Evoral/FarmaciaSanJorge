/**
 * Renders what one `registro_auditoria` row changed (M01/M03): a small
 * "Campo | Antes | Después" table with ONLY the fields that changed,
 * labeled and formatted for a non-technical reader
 * (../domain/presentacion.ts#calcularCambios), plus a collapsed "Ver
 * detalle técnico" block with the entidad code, full id, and the raw JSON
 * exactly as stored -- nothing is hidden, only reorganized.
 *
 * SECURITY: every value (the JSON is user-influenced) is rendered as
 * escaped React text content. This file NEVER opts into raw/unescaped HTML
 * injection and never puts a value into an `href`, inline `style`, or any
 * other markup/URL/CSS sink. Server component: `<details>` needs no JS.
 */
import { calcularCambios } from "../domain/presentacion";

function formatJson(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">{label}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        {formatJson(value)}
      </pre>
    </div>
  );
}

export interface AuditoriaDiffProps {
  entidad: string;
  entidadId: string;
  valorAnterior: unknown;
  valorNuevo: unknown;
  zonaHoraria: string;
  /** "Where from" (audit point 4): shown in the technical detail when present. */
  ip?: string | null;
  contexto?: unknown;
}

function textoDe(contexto: unknown, clave: string): string | null {
  if (typeof contexto !== "object" || contexto === null || Array.isArray(contexto)) return null;
  const valor = (contexto as Record<string, unknown>)[clave];
  return typeof valor === "string" ? valor : null;
}

export function AuditoriaDiff({ entidad, entidadId, valorAnterior, valorNuevo, zonaHoraria, ip, contexto }: AuditoriaDiffProps) {
  const userAgent = textoDe(contexto, "userAgent");
  const requestId = textoDe(contexto, "requestId");
  const cambios = calcularCambios(valorAnterior, valorNuevo, zonaHoraria);
  const conAntes = cambios.some((cambio) => cambio.antes !== null);
  const conDespues = cambios.some((cambio) => cambio.despues !== null);

  return (
    <div className="flex flex-col gap-2">
      {cambios.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Sin datos modificados.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th scope="col" className="py-1 pr-3 font-medium">Campo</th>
              {conAntes ? <th scope="col" className="py-1 pr-3 font-medium">{conDespues ? "Antes" : "Valor"}</th> : null}
              {conDespues ? <th scope="col" className="py-1 font-medium">{conAntes ? "Después" : "Valor"}</th> : null}
            </tr>
          </thead>
          <tbody>
            {cambios.map((cambio) => (
              <tr key={cambio.campo} className="align-top">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-zinc-600 dark:text-zinc-400">{cambio.etiqueta}</th>
                {conAntes ? <td className="break-words py-1 pr-3 text-zinc-500 line-through decoration-zinc-400 dark:text-zinc-400">{cambio.antes ?? "—"}</td> : null}
                {conDespues ? <td className="break-words py-1 font-medium">{cambio.despues ?? "—"}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200">
          Ver detalle técnico
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Entidad <span className="font-mono">{entidad}</span> · ID <span className="font-mono">{entidadId}</span>
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            IP <span className="font-mono">{ip ?? "—"}</span>
            {requestId ? (
              <>
                {" "}
                · Petición <span className="font-mono">{requestId}</span>
              </>
            ) : null}
          </p>
          {userAgent ? <p className="break-words text-xs text-zinc-500 dark:text-zinc-400">Navegador: {userAgent}</p> : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <JsonBlock label="Valor anterior" value={valorAnterior} />
            <JsonBlock label="Valor nuevo" value={valorNuevo} />
          </div>
        </div>
      </details>
    </div>
  );
}
