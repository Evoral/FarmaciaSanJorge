/**
 * "Integridad del libro" section of `/plataforma/farmacias/[id]` (openspec/specs/plataforma/spec.md P17, P19):
 * the integrity incidents of the pharmacy's libros, open first. View-only: no control changes an incident.
 */
import { etiquetaLibro } from "@/modules/libro/domain/integridad";
import { formatFechaHora } from "@/shared/format/fecha";
import { ToneBadge } from "@/shared/ui/status-badge";
import { ZONA_PLATAFORMA, type IncidenteIntegridad } from "../domain/farmacia";

const numberFormat = new Intl.NumberFormat("es-AR");

export function IncidentesIntegridad({ incidentes }: { incidentes: IncidenteIntegridad[] }) {
  return (
    <section id="integridad" className="panel scroll-mt-20" aria-labelledby="integridad-heading">
      <div className="panel-header">
        <h2 id="integridad-heading">Integridad del libro</h2>
      </div>
      <div className="panel-body flex flex-col gap-3">
        {incidentes.length === 0 ? (
          <p className="text-[0.8125rem] text-zinc-600">Sin incidentes de integridad registrados.</p>
        ) : (
          <ol className="flex flex-col gap-3">
            {incidentes.map((incidente) => {
              const abierto = incidente.resueltoEn === null;
              return (
                <li key={incidente.id} className="@container text-[0.8125rem]">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-medium text-zinc-900">{etiquetaLibro(incidente.libroTipo)}</span>
                    {abierto ? <ToneBadge tone="danger">Abierto</ToneBadge> : <ToneBadge tone="neutral">Resuelto</ToneBadge>}
                  </div>
                  <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-zinc-600 @lg:grid-cols-2">
                    <div>
                      <dt className="inline text-zinc-500">Primer quiebre: </dt>
                      <dd className="inline tabular-nums">asiento {incidente.primerQuiebreNumero}</dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Detecciones: </dt>
                      <dd className="inline tabular-nums">{numberFormat.format(incidente.detecciones)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Detectado: </dt>
                      <dd className="inline tabular-nums">{formatFechaHora(incidente.detectadoEn, ZONA_PLATAFORMA)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-zinc-500">Última detección: </dt>
                      <dd className="inline tabular-nums">{formatFechaHora(incidente.ultimaDeteccionEn, ZONA_PLATAFORMA)}</dd>
                    </div>
                    {incidente.resueltoEn ? (
                      <div>
                        <dt className="inline text-zinc-500">Resuelto: </dt>
                        <dd className="inline tabular-nums">{formatFechaHora(incidente.resueltoEn, ZONA_PLATAFORMA)}</dd>
                      </div>
                    ) : null}
                  </dl>
                </li>
              );
            })}
          </ol>
        )}
        <p className="field-help">
          Los incidentes se registran solo cuando un usuario de la farmacia con acceso al libro navega el sistema. Que no haya ninguno no prueba que los libros estén
          íntegros.
        </p>
      </div>
    </section>
  );
}
