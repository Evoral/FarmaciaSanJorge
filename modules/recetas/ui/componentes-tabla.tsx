/**
 * Read-only table of an ítem's componentes (droga, cantidad, modo, principio activo), as the receta detail page shows
 * them. Shared by /recetas/[id], the /preparaciones "Ver" preview and the toma workspace. Plain presentational
 * component (no hooks), so both Server and Client Components can render it.
 *
 * A componente loaded through a synonym shows that synonym, with the canonical name as a quiet hint
 * ("Acetaminofén ≈ Paracetamol", docs/specs/sinonimos-droga.md "Nombre elegido al cargar").
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
  return (
    <div className="overflow-x-auto">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">
              Droga
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Cantidad
            </th>
            <th scope="col" className="px-3 py-2">
              Modo
            </th>
            <th scope="col" className="px-3 py-2">
              <span className="sr-only">Principio activo</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {componentes.map((c) => (
            <tr key={c.id}>
              <td className="px-3 py-2 font-medium text-zinc-900">
                {c.sinonimo ? (
                  <>
                    {c.sinonimo}
                    <NombrePrincipalHint nombre={c.drogaNombre} />
                  </>
                ) : (
                  c.drogaNombre
                )}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
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
              <td className="px-3 py-2 text-zinc-600">{etiquetaDe(MODO_EXPRESION_LABELS, c.modoExpresion)}</td>
              <td className="px-3 py-2">
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
