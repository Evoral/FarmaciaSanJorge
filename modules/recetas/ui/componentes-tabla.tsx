/**
 * Read-only table of an ítem's componentes (droga, cantidad, modo, principio activo), as the receta detail page shows
 * them. Shared by /recetas/[id], the /preparaciones "Ver" preview and the toma workspace. Plain presentational
 * component (no hooks), so both Server and Client Components can render it.
 *
 * A componente loaded through a synonym shows that synonym, with the canonical name as a quiet hint
 * ("Acetaminofén ≈ Paracetamol", openspec/specs/sinonimos-droga/spec.md "Nombre elegido al cargar").
 */
import { MODO_EXPRESION_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { ToneBadge } from "@/shared/ui/status-badge";
import { NombrePrincipalHint } from "@/shared/ui/sinonimo-hint";

export interface ComponenteVista {
  id: string;
  /** Canonical name. */
  drogaNombre: string;
  /** The synonym the componente was loaded with (migration 0069), if any. */
  sinonimo?: string | null;
  /** Decimal as text; `null` for a CSP componente. */
  cantidad: string | null;
  unidadMedidaSimbolo: string;
  modoExpresion: string;
  esPrincipioActivo: boolean;
}

export function ComponentesTabla({ componentes }: { componentes: readonly ComponenteVista[] }) {
  if (componentes.length === 0) return <p className="text-sm text-zinc-500">El ítem no tiene componentes cargados.</p>;
  const tienePrincipioActivo = componentes.some((c) => c.esPrincipioActivo);
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-2 sm:px-3">
              Droga
            </th>
            <th scope="col" className="px-2 py-2 text-right sm:px-3">
              Cantidad
            </th>
            <th scope="col" className="px-2 py-2 sm:px-3">
              Modo
            </th>
            <th scope="col" className={tienePrincipioActivo ? "px-1.5 py-2 sm:px-3" : "w-0 p-0"}>
              <span className="sr-only">Principio activo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {componentes.map((c) => (
            <tr key={c.id}>
              <td className="px-2 py-2 font-medium text-zinc-900 sm:px-3">
                {c.sinonimo ? (
                  <>
                    {c.sinonimo}
                    <NombrePrincipalHint nombre={c.drogaNombre} />
                  </>
                ) : (
                  c.drogaNombre
                )}
              </td>
              <td className="whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums sm:px-3">
                {c.cantidad ? (
                  <>
                    {c.cantidad} <span className="text-zinc-500">{c.unidadMedidaSimbolo}</span>
                  </>
                ) : (
                  <span className="text-zinc-400">
                    -<span className="sr-only">Sin cantidad</span>
                  </span>
                )}
              </td>
              <td className="px-2 py-2 text-zinc-600 sm:px-3">{etiquetaDe(MODO_EXPRESION_LABELS, c.modoExpresion)}</td>
              <td
                className={
                  tienePrincipioActivo
                    ? "px-1.5 py-2 text-right sm:px-3 sm:text-left [&>.badge]:whitespace-normal [&>.badge]:text-center sm:[&>.badge]:whitespace-nowrap"
                    : "w-0 p-0"
                }
              >
                {c.esPrincipioActivo ? (
                  <ToneBadge tone="success">Principio activo</ToneBadge>
                ) : (
                  <span className="sr-only">No es principio activo</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
