/**
 * "Resumen" cards of the Trayectoria: counters over ALL the paciente's
 * recetas (not just the visible page). Server component. HEALTH-ADJACENT
 * DATA (DP-24): shown only behind `pacientes.gestionar`.
 */
import { formatFecha } from "@/shared/format/fecha";
import type { ResumenTrayectoria } from "../domain/trayectoria";

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string | number }) {
  return (
    <div className="card p-4">
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="mt-1 text-2xl font-semibold">{valor}</dd>
    </div>
  );
}

export function TrayectoriaResumen({ resumen, zonaHoraria }: { resumen: ResumenTrayectoria; zonaHoraria: string }) {
  return (
    <section aria-labelledby="trayectoria-resumen" className="mb-8">
      <h2 id="trayectoria-resumen" className="mb-3 text-lg font-medium">
        Resumen
      </h2>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Dato etiqueta="Recetas" valor={resumen.total} />
        <Dato etiqueta="En curso" valor={resumen.enCurso} />
        <Dato etiqueta="Entregadas" valor={resumen.entregadas} />
        <Dato etiqueta="Anuladas" valor={resumen.anuladas} />
        <Dato etiqueta="Última atención" valor={resumen.ultimaAtencion ? formatFecha(resumen.ultimaAtencion, zonaHoraria) : "—"} />
      </dl>
    </section>
  );
}
