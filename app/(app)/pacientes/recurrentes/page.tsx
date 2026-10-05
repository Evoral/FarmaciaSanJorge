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
 * The ventana filter is a strip of tabs with the use case's own per-window
 * counts (`conteo`): the number the user reads is the tab they click.
 *
 * `/pacientes/recurrentes` is a STATIC segment next to the dynamic
 * `/pacientes/[id]`: Next.js matches static segments first, so `recurrentes` is
 * never read as an `[id]` (and never reaches that layout's uuid guard).
 */
import Link from "next/link";
import { CalendarClock, Repeat } from "lucide-react";
import { listPacientesRecurrentes } from "@/modules/pacientes/application/list-pacientes-recurrentes";
import { OCURRENCIAS_MINIMAS, PAGE_MAX_RECURRENTES, VENTANA_MESES } from "@/modules/pacientes/domain/recurrentes";
import type { VentanaRecurrentes } from "@/modules/pacientes/domain/recurrentes";
import { RecurrentesTabla } from "@/modules/pacientes/ui/recurrentes-tabla";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { PacientesTabs } from "../pacientes-tabs";

interface RecurrentesPageProps {
  searchParams: Promise<{ ventana?: string; page?: string }>;
}

const numberFormat = new Intl.NumberFormat("es-AR");

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

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pacientes", href: "/pacientes" }, { label: "Recurrentes" }]}
        title="Pacientes"
        description="Datos de contacto de cada paciente y el recorrido de sus recetas."
      />

      <PacientesTabs />

      <div className="mb-4">
        <StatusSummary
          label="Filtrar por fecha del próximo pedido"
          unit={["pedido", "pedidos"]}
          all={{ label: "Todos", count: conteo.todos, href: "/pacientes/recurrentes?ventana=todos", active: ventana === "todos" }}
          items={[
            {
              key: "proximos",
              label: "Próximos",
              count: conteo.proximos,
              href: "/pacientes/recurrentes",
              active: ventana === "proximos",
              tone: "warn",
            },
          ]}
          note={regla}
        />
      </div>

      <div className="list-panel">
        <div className="list-toolbar">
          <p role="status">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(paginacion.total)}</span>{" "}
            {paginacion.total === 1 ? "pedido recurrente" : "pedidos recurrentes"}
            <span className="text-zinc-500">{ventana === "proximos" ? " atrasados o de esta semana" : ""}</span>
          </p>
          <p className="hidden text-xs text-zinc-500 md:block">WhatsApp solo para quienes aceptaron recordatorios y tienen un teléfono válido.</p>
        </div>

        {filas.length === 0 ? (
          ventana === "proximos" && masAdelante > 0 ? (
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title="Nada atrasado ni previsto para esta semana"
              description={`${numberFormat.format(masAdelante)} ${masAdelante === 1 ? "pedido más tiene" : "pedidos más tienen"} fecha posterior.`}
              action={
                <Link href="/pacientes/recurrentes?ventana=todos" scroll={false} className="btn btn-secondary">
                  Ver todos
                </Link>
              }
            />
          ) : (
            <EmptyState icon={<Repeat className="size-5" />} title="Todavía no hay pedidos recurrentes" description={regla} />
          )
        ) : (
          <RecurrentesTabla filas={filas} zonaHoraria={zonaHoraria} />
        )}

        <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500 md:hidden">WhatsApp solo para quienes aceptaron recordatorios y tienen un teléfono válido.</p>
        <Pagination page={paginacion.page} pageSize={paginacion.pageSize} total={paginacion.total} hrefFor={pageHref} label="Paginación de pacientes recurrentes" />
      </div>
    </>
  );
}
