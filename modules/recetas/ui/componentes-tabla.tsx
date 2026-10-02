/**
 * Read-only table of an ítem's componentes (droga, cantidad, modo, principio activo), as the receta detail page shows
 * them. Shared by /recetas/[id], the /preparaciones "Ver" preview and the toma workspace. Plain presentational
 * component (no hooks), so both Server and Client Components can render it.
 */
import { MODO_EXPRESION_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";

export interface ComponenteVista {
  id: string;
  drogaNombre: string;
  /** Decimal as text; `null` for a CSP componente. */
  cantidad: string | null;
  unidadMedidaSimbolo: string;
  modoExpresion: string;
  esPrincipioActivo: boolean;
}

export function ComponentesTabla({ componentes }: { componentes: readonly ComponenteVista[] }) {
  return (
    <table className="data-table">
      <thead className="border-b border-zinc-200 dark:border-zinc-800">
        <tr>
          <th scope="col" className="py-1 font-medium">
            Droga
          </th>
          <th scope="col" className="py-1 font-medium">
            Cantidad
          </th>
          <th scope="col" className="py-1 font-medium">
            Modo
          </th>
          <th scope="col" className="py-1 font-medium">
            Principio activo
          </th>
        </tr>
      </thead>
      <tbody>
        {componentes.length === 0 ? (
          <tr>
            <td colSpan={4} className="py-2 text-zinc-500">
              El ítem no tiene componentes cargados.
            </td>
          </tr>
        ) : (
          componentes.map((c) => (
            <tr key={c.id}>
              <td className="py-1">{c.drogaNombre}</td>
              <td className="py-1">{c.cantidad ? `${c.cantidad} ${c.unidadMedidaSimbolo}` : "—"}</td>
              <td className="py-1">{etiquetaDe(MODO_EXPRESION_LABELS, c.modoExpresion)}</td>
              <td className="py-1">{c.esPrincipioActivo ? "Sí" : "No"}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
