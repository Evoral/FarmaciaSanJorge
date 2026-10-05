"use client";

/**
 * Search + results for `/pacientes` (FASE 4 point 4.5, DP-24). The search term (apellido or DNI -- both identifying)
 * only ever travels through `buscarPacientesAction` (a POST'd Server Action call, never a `<form method="get">` page
 * navigation), so it never appears in the URL/query string. Starts from the server-rendered
 * `itemsIniciales`/`totalInicial` (the page's own default, non-identifying `estado`-filtered listing).
 *
 * The search is an AUTOCOMPLETE over that same action (same pattern as modules/entregas/ui/entregas-buscador.tsx):
 * typing lists the matching pacientes and picking one opens its Datos (opaque id in the URL). Its last row ("Ver todas
 * las coincidencias") applies the term to the table below instead; clearing the box shows the page's listing again.
 * The table stays visible (dimmed) while it updates.
 */
import { useActionState, useCallback, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ListFilter, SearchX, Users } from "lucide-react";
import { buscarPacientesAction } from "./buscar-pacientes-action";
import type { BuscarPacientesState, PacienteListItem } from "./buscar-pacientes-action";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { Combobox } from "@/shared/ui/combobox";
import { ToneBadge } from "@/shared/ui/status-badge";
import { Avatar } from "@/shared/ui/avatar";
import { EmptyState } from "@/shared/ui/empty-state";

const numberFormat = new Intl.NumberFormat("es-AR");

export interface PacientesBuscadorProps {
  itemsIniciales: PacienteListItem[];
  totalInicial: number;
  estado: string;
  /** The page's own GET filters (estado), shown next to the search box. */
  filtros?: ReactNode;
  /** Active-filter chips, shown under the filter bar. */
  filtrosActivos?: ReactNode;
  /** The page's pagination of the default listing; hidden while a search is applied (the search shows page 1 only). */
  paginacion?: ReactNode;
  /** Empty state of the default listing (it depends on the page's filters). */
  vacio?: ReactNode;
}

export function PacientesBuscador({ itemsIniciales, totalInicial, estado, filtros, filtrosActivos, paginacion, vacio }: PacientesBuscadorProps) {
  const router = useRouter();
  const initialState: BuscarPacientesState = { status: "idle", items: itemsIniciales, total: totalInicial };
  const [state, formAction, isPending] = useActionState(buscarPacientesAction, initialState);
  // Not reset on success: the applied search stays next to its results.
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const [busquedaAplicada, setBusquedaAplicada] = useState("");

  /** Applies `q` to the table (same POST action as before). */
  function filtrarTabla(q: string) {
    if (!qRef.current) return;
    qRef.current.value = q;
    setBusquedaAplicada(q);
    formRef.current?.requestSubmit();
  }

  // The autocomplete's source: the same action, read directly (its own request; the table is untouched).
  const search = useCallback(
    async (q: string) => {
      const formData = new FormData();
      formData.set("q", q);
      formData.set("estado", estado);
      const result = await buscarPacientesAction({ status: "idle", items: [], total: 0 }, formData);
      if (result.status === "error") throw new Error(result.message);
      return result.items.map((p) => ({
        value: p.id,
        label: `${p.apellido}, ${p.nombre}`,
        description: [p.dni ? `DNI ${p.dni}` : null, p.fechaBaja ? "Baja" : null].filter(Boolean).join(" · ") || undefined,
      }));
    },
    [estado],
  );

  const conBusqueda = state.status !== "idle" && busquedaAplicada !== "";

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} aria-label="Filtrar pacientes" aria-busy={isPending} hidden>
        <input ref={qRef} type="hidden" name="q" defaultValue="" />
        <input type="hidden" name="estado" value={estado} />
      </form>

      <section aria-label="Búsqueda y filtros">
        <div className="filter-bar">
          <div className="min-w-0 flex-1 md:w-96 md:flex-none">
            <Combobox
              id="pacientes-buscar"
              label="Buscar paciente"
              hideLabel
              placeholder="Buscar por apellido o DNI"
              search={search}
              value={busquedaAplicada ? { value: "", label: busquedaAplicada } : null}
              onChange={(option) => {
                if (!option) {
                  if (busquedaAplicada) filtrarTabla("");
                  return;
                }
                router.push(`/pacientes/${option.value}`);
              }}
              actionOption={{
                label: (q) => (q ? `Ver todas las coincidencias de “${q}”` : "Ver todos los pacientes"),
                onSelect: filtrarTabla,
                icon: <ListFilter className="size-4 flex-none" aria-hidden />,
              }}
            />
          </div>
          {filtros}
        </div>
        {filtrosActivos}
      </section>

      {state.status === "error" ? (
        <p role="alert" className="alert alert-danger">
          {state.message}
        </p>
      ) : null}

      <div className="list-panel transition-opacity" style={{ opacity: isPending ? 0.55 : 1 }}>
        <div className="list-toolbar">
          <p role="status">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(state.total)}</span> {state.total === 1 ? "paciente" : "pacientes"}
            {conBusqueda ? <span className="text-zinc-500"> para “{busquedaAplicada}”</span> : null}
          </p>
          {isPending ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="spinner" aria-hidden />
              Actualizando…
            </span>
          ) : null}
        </div>

        {state.items.length === 0 ? (
          conBusqueda ? (
            <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="Ningún paciente coincide con esa búsqueda." />
          ) : (
            vacio ?? <EmptyState icon={<Users className="size-5" />} title="Todavía no hay pacientes" />
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Paciente
                  </th>
                  <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                    DNI
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((paciente) => {
                  const nombre = `${paciente.apellido}, ${paciente.nombre}`;
                  return (
                    <tr key={paciente.id}>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={nombre} />
                          <span className="min-w-0">
                            <Link href={`/pacientes/${paciente.id}`} className="block truncate font-medium text-zinc-900 underline-offset-2 hover:underline">
                              {nombre}
                            </Link>
                            {paciente.dni ? <span className="block font-mono text-xs text-zinc-500 sm:hidden">DNI {paciente.dni}</span> : null}
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 font-mono sm:table-cell">
                        {paciente.dni ?? (
                          <span className="text-zinc-400">
                            -<span className="sr-only">Sin DNI</span>
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={paciente.fechaBaja ? "neutral" : "success"}>{paciente.fechaBaja ? "Baja" : "Vigente"}</ToneBadge>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center justify-end gap-1">
                          <Link href={`/pacientes/${paciente.id}/historial`} className="btn btn-ghost btn-sm" aria-label={`Ver el historial de ${paciente.nombre} ${paciente.apellido}`}>
                            <span className="hidden sm:inline">Historial</span>
                            <span className="sm:hidden">Ver</span>
                          </Link>
                          <Link href={`/pacientes/${paciente.id}`} aria-label={`Ver los datos de ${paciente.nombre} ${paciente.apellido}`} className="btn btn-ghost btn-sm btn-icon">
                            <ChevronRight className="size-4" aria-hidden />
                          </Link>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {conBusqueda ? (
          state.total > state.items.length ? (
            <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
              Mostrando los primeros {state.items.length} resultados. Afiná la búsqueda para acotar.
            </p>
          ) : null
        ) : (
          paginacion
        )}
      </div>
    </div>
  );
}
