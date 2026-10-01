/**
 * `/pacientes/recurrentes` (docs/specs/pacientes-recurrentes.md): patients who
 * periodically order the same preparation, with a one-click WhatsApp reminder.
 * HEALTH-ADJACENT DATA (DP-24, Ley 25.326): `searchParams` ONLY ever reads
 * `ventana` ("todos"; anything else is the default "próximos") and `page` (a
 * plain integer) -- nothing identifying goes in OUR URL. The only identifying
 * link on the page is the `wa.me` one, built by the use case (see
 * `modules/pacientes/ui/recurrentes-tabla.tsx`). Access is the parent layout's
 * `pacientes.gestionar` guard (and the use case's own).
 *
 * `/pacientes/recurrentes` is a STATIC segment next to the dynamic
 * `/pacientes/[id]`: Next.js matches static segments first, so `recurrentes` is
 * never read as an `[id]` (and never reaches that layout's uuid guard).
 */
import Link from "next/link";
import { listPacientesRecurrentes } from "@/modules/pacientes/application/list-pacientes-recurrentes";
import { OCURRENCIAS_MINIMAS, PAGE_MAX_RECURRENTES, VENTANA_MESES } from "@/modules/pacientes/domain/recurrentes";
import type { VentanaRecurrentes } from "@/modules/pacientes/domain/recurrentes";
import { RecurrentesTabla } from "@/modules/pacientes/ui/recurrentes-tabla";
import { FilterForm } from "@/shared/ui/filter-form";
import { PacientesTabs } from "../pacientes-tabs";

interface RecurrentesPageProps {
  searchParams: Promise<{ ventana?: string; page?: string }>;
}

export default async function PacientesRecurrentesPage({ searchParams }: RecurrentesPageProps) {
  const params = await searchParams;
  const ventana: VentanaRecurrentes = params.ventana === "todos" ? "todos" : "proximos";
  // Clamped into the use case's accepted range (a huge digit string parses to Infinity); the use case then clamps to the last page.
  const parsedPage = Number.parseInt(params.page ?? "1", 10);
  const requestedPage = Number.isFinite(parsedPage) ? Math.min(PAGE_MAX_RECURRENTES, Math.max(1, parsedPage)) : 1;

  const { filas, paginacion, conteo, zonaHoraria } = await listPacientesRecurrentes({ ventana, page: requestedPage });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams();
    if (ventana === "todos") qs.set("ventana", ventana);
    qs.set("page", String(targetPage));
    return `/pacientes/recurrentes?${qs.toString()}`;
  }

  const regla = `Aparecen los pacientes que pidieron la misma fórmula ${OCURRENCIAS_MINIMAS} o más veces en los últimos ${VENTANA_MESES} meses.`;
  const masAdelante = conteo.todos - conteo.proximos;
  const mensajeVacio =
    ventana === "proximos" && masAdelante > 0
      ? `No hay pacientes con el pedido atrasado o previsto para esta semana. ${masAdelante} más con fecha posterior: seleccione «Todos» en el filtro. ${regla}`
      : regla;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Pacientes</h1>
      </div>

      <PacientesTabs />

      <FilterForm className="mb-6 flex flex-wrap items-end gap-3" aria-label="Filtro de pacientes recurrentes" hasActiveFilters={ventana === "todos"}>
        <div className="flex flex-col gap-1">
          <label htmlFor="ventana" className="text-sm font-medium">
            Mostrar
          </label>
          <select id="ventana" name="ventana" defaultValue={ventana === "todos" ? "todos" : ""} className="input">
            <option value="">Próximos (atrasados y de esta semana)</option>
            <option value="todos">Todos (incluye fechas posteriores)</option>
          </select>
        </div>
      </FilterForm>

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {paginacion.total} pedido{paginacion.total === 1 ? "" : "s"} recurrente{paginacion.total === 1 ? "" : "s"}. El WhatsApp solo se ofrece a quienes aceptaron recordatorios y tienen un teléfono válido.
      </p>

      <RecurrentesTabla filas={filas} zonaHoraria={zonaHoraria} mensajeVacio={mensajeVacio} />

      {paginacion.totalPages > 1 ? (
        <nav aria-label="Paginación de pacientes recurrentes" className="mt-4 flex items-center gap-2 text-sm">
          <Link
            href={pageHref(Math.max(1, paginacion.page - 1))}
            aria-disabled={paginacion.page <= 1}
            className={paginacion.page <= 1 ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Anterior
          </Link>
          <span>
            Página {paginacion.page} de {paginacion.totalPages}
          </span>
          <Link
            href={pageHref(Math.min(paginacion.totalPages, paginacion.page + 1))}
            aria-disabled={paginacion.page >= paginacion.totalPages}
            className={paginacion.page >= paginacion.totalPages ? "pointer-events-none text-zinc-400" : "underline"}
          >
            Siguiente
          </Link>
        </nav>
      ) : null}
    </div>
  );
}
