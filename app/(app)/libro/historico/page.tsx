/** `/libro/historico` (FASE 9, M12 point 9.5, DP-17). Digitalización y consulta de asientos históricos del libro físico. */
import { Info, ScrollText } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listHistorico } from "@/modules/libro/application/list-historico";
import { HistoricoForm } from "@/modules/libro/ui/historico-form";
import { LibroNav } from "@/modules/libro/ui/libro-nav";
import { formatFechaIso } from "@/shared/format/fecha";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { ToneBadge } from "@/shared/ui/status-badge";

const TIPO_LABELS: Record<string, string> = {
  RECETARIO: "Recetario",
  PSICOTROPICO: "Psicotrópicos",
  ESTUPEFACIENTE: "Estupefacientes",
};

function Vacio({ label }: { label: string }) {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">{label}</span>
    </span>
  );
}

export default async function HistoricoPage() {
  const session = await requireSession();
  const puedeDigitalizar = can(session, "libro.historico.digitalizar");

  const result = await listHistorico({ page: 1, pageSize: 50 });

  return (
    <div className="page">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Libro", href: "/libro" }, { label: "Asientos históricos" }]}
        title="Asientos históricos"
        description="Relevamiento del libro físico anterior al sistema."
      />

      <LibroNav actual="historico" />

      <div role="note" className="alert alert-info mb-5">
        <Info aria-hidden />
        <p>Solo para relevamiento de datos del libro físico: no forman parte del libro digital, no consumen correlativo ni cadena de hash y no generan movimientos de stock.</p>
      </div>

      <div className={puedeDigitalizar ? "split-layout" : undefined}>
        <section aria-labelledby="historicos-heading" className="list-panel min-w-0">
          <div className="list-toolbar">
            <h2 id="historicos-heading" className="flex items-center gap-2 font-medium text-zinc-900">
              Digitalizados <span className="tab-count">{result.items.length}</span>
            </h2>
          </div>
          {result.items.length === 0 ? (
            <EmptyState icon={<ScrollText className="size-5" />} title="No hay asientos históricos digitalizados" description={puedeDigitalizar ? "Cargá el primero desde el panel de la derecha." : undefined} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2">
                      Libro
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Nº físico
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fecha
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Paciente
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Médico
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Digitalizado por
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone="neutral">{TIPO_LABELS[item.tipoLibro] ?? item.tipoLibro}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5 font-mono font-semibold text-zinc-900">{item.numeroAsientoFisico}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{formatFechaIso(item.fechaAsiento)}</td>
                      <td className="px-3 py-2.5 text-zinc-900">{item.pacienteTexto ?? <Vacio label="Sin paciente" />}</td>
                      <td className="hidden px-3 py-2.5 md:table-cell">{item.medicoTexto ?? <Vacio label="Sin médico" />}</td>
                      <td className="hidden px-3 py-2.5 text-zinc-600 lg:table-cell">{item.digitalizadoPorNombre}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {puedeDigitalizar ? (
          <aside className="split-aside" aria-label="Digitalizar un asiento">
            <section className="panel" aria-labelledby="digitalizar-heading">
              <div className="panel-header">
                <h2 id="digitalizar-heading">Digitalizar un asiento</h2>
                <p>Transcribí los datos tal como figuran en el libro físico.</p>
              </div>
              <div className="panel-body">
                <HistoricoForm />
              </div>
            </section>
          </aside>
        ) : null}
      </div>
    </div>
  );
}
