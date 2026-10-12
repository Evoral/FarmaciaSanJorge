/**
 * "Imprimir ficha técnica": opens the ficha's ticket PDF (80 mm thermal printer,
 * modules/elaboracion/infrastructure/ficha-pdf.ts) in a new tab to print it. Server-safe presentational component;
 * callers render it only with `fichas.imprimir`.
 */
import { Printer } from "lucide-react";

export function ImprimirFichaLink({ fichaTecnicaId, className = "btn btn-secondary" }: { fichaTecnicaId: string; className?: string }) {
  return (
    <a href={`/api/fichas-tecnicas/${fichaTecnicaId}/pdf`} target="_blank" rel="noreferrer" className={className}>
      <Printer className="size-4" aria-hidden />
      Imprimir ficha técnica
    </a>
  );
}
