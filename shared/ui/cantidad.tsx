/**
 * A quantity formatted by `shared/format/cantidad.ts`: the rounded text,
 * with the exact, unrounded value (in its original unit) as a tooltip.
 * No hooks, so it renders in Server and Client Components alike.
 */
import type { CantidadFormateada } from "@/shared/format/cantidad";

export function Cantidad({ valor }: { valor: CantidadFormateada }) {
  return (
    <span title={valor.exacto} className="whitespace-nowrap">
      {valor.texto}
    </span>
  );
}
