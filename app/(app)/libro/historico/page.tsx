/** `/libro/historico` (FASE 9, M12 point 9.5, DP-17). Digitalización y consulta de asientos históricos del libro físico. */
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listHistorico } from "@/modules/libro/application/list-historico";
import { HistoricoForm } from "@/modules/libro/ui/historico-form";

const TIPO_LABELS: Record<string, string> = {
  RECETARIO: "Recetario",
  PSICOTROPICO: "Psicotrópicos",
  ESTUPEFACIENTE: "Estupefacientes",
};

export default async function HistoricoPage() {
  const session = await requireSession();
  const puedeDigitalizar = can(session, "libro.historico.digitalizar");

  const result = await listHistorico({ page: 1, pageSize: 50 });

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">Asientos históricos</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Solo para relevamiento de datos del libro físico -- no forman parte del libro digital, no consumen correlativo ni cadena de hash, no generan movimientos de stock (DP-17).
      </p>

      {puedeDigitalizar ? (
        <div className="mb-8">
          <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">Digitalizar un asiento</h2>
          <HistoricoForm />
        </div>
      ) : null}

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Libro</th>
              <th scope="col" className="px-3 py-2 font-medium">Nº físico</th>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Médico</th>
              <th scope="col" className="px-3 py-2 font-medium">Digitalizado por</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                  No hay asientos históricos digitalizados.
                </td>
              </tr>
            ) : (
              result.items.map((item) => (
                <tr key={item.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">{TIPO_LABELS[item.tipoLibro] ?? item.tipoLibro}</td>
                  <td className="px-3 py-2">{item.numeroAsientoFisico}</td>
                  <td className="px-3 py-2">{item.fechaAsiento}</td>
                  <td className="px-3 py-2">{item.pacienteTexto ?? "—"}</td>
                  <td className="px-3 py-2">{item.medicoTexto ?? "—"}</td>
                  <td className="px-3 py-2">{item.digitalizadoPorNombre}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
