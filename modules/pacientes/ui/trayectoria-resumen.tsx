/**
 * "Resumen" strip of the Trayectoria: counters over ALL the paciente's recetas (not just the visible page), one cell
 * each in a single panel. Server component. HEALTH-ADJACENT DATA (DP-24): shown only behind `pacientes.gestionar`.
 */
import { formatFecha } from "@/shared/format/fecha";
import type { ResumenTrayectoria } from "../domain/trayectoria";

const numberFormat = new Intl.NumberFormat("es-AR");

function Dato({ etiqueta, valor, className = "" }: { etiqueta: string; valor: string; className?: string }) {
  return (
    <div className={`min-w-0 bg-(--surface) px-4 py-3.5 ${className}`}>
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="summary-count mt-1.5 [overflow-wrap:anywhere]">{valor}</dd>
    </div>
  );
}

export function TrayectoriaResumen({ resumen, zonaHoraria }: { resumen: ResumenTrayectoria; zonaHoraria: string }) {
  return (
    <section aria-labelledby="trayectoria-resumen" className="mb-6">
      <h2 id="trayectoria-resumen" className="sr-only">
        Resumen
      </h2>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 md:grid-cols-5">
        <Dato etiqueta="Recetas" valor={numberFormat.format(resumen.total)} />
        <Dato etiqueta="En curso" valor={numberFormat.format(resumen.enCurso)} />
        <Dato etiqueta="Entregadas" valor={numberFormat.format(resumen.entregadas)} />
        <Dato etiqueta="Anuladas" valor={numberFormat.format(resumen.anuladas)} />
        <Dato
          etiqueta="Última atención"
          valor={resumen.ultimaAtencion ? formatFecha(resumen.ultimaAtencion, zonaHoraria) : "-"}
          className="col-span-2 md:col-span-1"
        />
      </dl>
    </section>
  );
}
