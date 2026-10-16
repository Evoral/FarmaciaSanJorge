"use client";

/**
 * Search + results for `/entregas` (FASE 11, DP-24 discipline -- see buscar-entregas-action.ts's doc comment). Own
 * copy per module, same shape as modules/pacientes/ui/pacientes-buscador.tsx.
 *
 * The paciente search is an AUTOCOMPLETE over the same POST Server Action (the term never reaches a URL): typing lists
 * the matching pending recetas (paciente, Nº, estado) and picking one opens its entrega. Its last row ("Ver todas las
 * coincidencias") applies the term to the table below instead, through the same action; clearing the box shows the
 * full list again. The table stays visible (dimmed) while it updates.
 */
import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, ListFilter, PackageCheck, SearchX } from "lucide-react";
import { buscarEntregasAction } from "./buscar-entregas-action";
import type { BuscarEntregasState } from "./buscar-entregas-action";
import type { EntregaPendienteItem } from "@/modules/entregas/application/list-entregas-pendientes";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { Combobox } from "@/shared/ui/combobox";
import { StatusBadge } from "@/shared/ui/status-badge";
import { Avatar } from "@/shared/ui/avatar";
import { EmptyState } from "@/shared/ui/empty-state";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";

/** Row button once the envío left and the firma is awaited. */
const ETIQUETA_ACCION_ENVIADA = "Esperando retorno";

const numberFormat = new Intl.NumberFormat("es-AR");

function etiquetaEstado(estado: string): string {
  return Object.hasOwn(ESTADO_RECETA_LABELS, estado) ? ESTADO_RECETA_LABELS[estado as keyof typeof ESTADO_RECETA_LABELS] : estado;
}

export interface EntregasBuscadorProps {
  itemsIniciales: EntregaPendienteItem[];
  totalInicial: number;
  /** The page's pagination of the default listing; hidden while a search is applied (the search shows page 1 only). */
  paginacion?: ReactNode;
  /** The page's URL filters (`FilterForm`, none identifying a paciente); the POST search applies them too. */
  filtros: { estado: string; numero: string; ingresoDesde: string; ingresoHasta: string };
  /** The `FilterForm` rendered next to the paciente search, and the active-filter chips under the bar. */
  controles?: ReactNode;
  chips?: ReactNode;
}

export function EntregasBuscador({ itemsIniciales, totalInicial, paginacion, filtros, controles, chips }: EntregasBuscadorProps) {
  const hayFiltros = Object.values(filtros).some(Boolean);
  const router = useRouter();
  const initialState: BuscarEntregasState = { status: "idle", items: itemsIniciales, total: totalInicial };
  const [state, formAction, isPending] = useActionState(buscarEntregasAction, initialState);
  // Not reset on success: the applied search stays next to its results.
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const qRef = useRef<HTMLInputElement>(null);
  const [busquedaAplicada, setBusquedaAplicada] = useState("");

  // An entrega registered from the pop-up refreshes the page's props, but `useActionState` keeps its first state: show
  // the page's own (paginated) listing while no search applies -- also after a search is cleared -- and re-run an
  // applied search so its rows are current too.
  const conBusqueda = state.status !== "idle" && busquedaAplicada !== "";
  const items = conBusqueda ? state.items : itemsIniciales;
  const total = conBusqueda ? state.total : totalInicial;
  useEffect(() => {
    // The hidden `q` input holds the applied search (see filtrarTabla).
    if (qRef.current?.value) formRef.current?.requestSubmit();
  }, [itemsIniciales]);

  /** Applies `q` to the table (same POST action as before). */
  function filtrarTabla(q: string) {
    if (!qRef.current) return;
    qRef.current.value = q;
    setBusquedaAplicada(q);
    formRef.current?.requestSubmit();
  }

  // The autocomplete's source: the same action, read directly (its own request; the table is untouched).
  const { estado, numero, ingresoDesde, ingresoHasta } = filtros;
  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    formData.set("estado", estado);
    formData.set("numero", numero);
    formData.set("ingresoDesde", ingresoDesde);
    formData.set("ingresoHasta", ingresoHasta);
    const result = await buscarEntregasAction({ status: "idle", items: [], total: 0 }, formData);
    if (result.status === "error") throw new Error(result.message);
    return result.items.map((r) => ({
      value: r.id,
      label: `${r.pacienteNombre} ${r.pacienteApellido}`,
      description: `Nº ${r.numeroInterno} · ${etiquetaEstado(r.estado)}`,
    }));
  }, [estado, numero, ingresoDesde, ingresoHasta]);

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} aria-label="Filtrar entregas pendientes" aria-busy={isPending} hidden>
        <input ref={qRef} type="hidden" name="q" defaultValue="" />
        <input type="hidden" name="estado" value={estado} readOnly />
        <input type="hidden" name="numero" value={numero} readOnly />
        <input type="hidden" name="ingresoDesde" value={ingresoDesde} readOnly />
        <input type="hidden" name="ingresoHasta" value={ingresoHasta} readOnly />
      </form>

      <div className="filter-bar">
        <div className="min-w-0 flex-1 md:w-96 md:flex-none">
          <Combobox
            id="entregas-paciente"
            label="Buscar por paciente"
            hideLabel
            placeholder="Buscar por apellido o nombre del paciente"
            search={search}
            value={busquedaAplicada ? { value: "", label: busquedaAplicada } : null}
            onChange={(option) => {
              if (!option) {
                if (busquedaAplicada) filtrarTabla("");
                return;
              }
              router.push(`/entregas/${option.value}`);
            }}
            actionOption={{
              label: (q) => (q ? `Ver todas las coincidencias de “${q}”` : "Ver todas las recetas pendientes"),
              onSelect: filtrarTabla,
              icon: <ListFilter className="size-4 flex-none" aria-hidden />,
            }}
          />
        </div>
        {controles}
      </div>
      {chips}

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      <div className="list-panel transition-opacity" style={{ opacity: isPending ? 0.55 : 1 }}>
        <div className="list-toolbar">
          <p role="status">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span>{" "}
            {total === 1 ? "receta pendiente" : "recetas pendientes"} de entrega
            {busquedaAplicada ? <span className="text-zinc-500"> para “{busquedaAplicada}”</span> : null}
          </p>
          {isPending ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="spinner" aria-hidden />
              Actualizando…
            </span>
          ) : null}
        </div>

        {items.length === 0 ? (
          conBusqueda || hayFiltros ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title="Sin resultados"
              description={conBusqueda ? "Ninguna receta pendiente de entrega coincide con esa búsqueda y los filtros aplicados." : "Ninguna receta pendiente de entrega coincide con los filtros aplicados."}
            />
          ) : (
            <EmptyState icon={<PackageCheck className="size-5" />} title="No hay recetas pendientes de entrega" description="Las recetas preparadas aparecen acá para entregarlas o enviarlas." />
          )
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Nº
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Paciente
                  </th>
                  <th scope="col" className="hidden px-3 py-2 md:table-cell">
                    Médico
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
                {items.map((r) => {
                  const paciente = `${r.pacienteNombre} ${r.pacienteApellido}`;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/entregas/${r.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                          {r.numeroInterno}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex min-w-0 items-center gap-2.5">
                          <Avatar name={paciente} />
                          <span className="min-w-0">
                            <span className="block max-w-[16rem] truncate font-medium text-zinc-900" title={paciente}>
                              {paciente}
                            </span>
                            <span className="block max-w-[12rem] truncate text-xs text-zinc-500 md:hidden" title={`${r.medicoApellido}, ${r.medicoNombre}`}>
                              {r.medicoApellido}, {r.medicoNombre}
                            </span>
                          </span>
                        </span>
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {r.medicoApellido}, {r.medicoNombre}
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusBadge estado={r.estado} />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <Link href={`/entregas/${r.id}`} aria-label={`Gestionar la entrega de la receta Nº ${r.numeroInterno}`} className="btn btn-ghost btn-sm">
                          <span className="hidden sm:inline">{r.estado === "ENVIADA_PEND_FIRMA" ? ETIQUETA_ACCION_ENVIADA : "Entregar"}</span>
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {conBusqueda ? (
          total > items.length ? (
            <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
              Mostrando los primeros {items.length} resultados. Afiná la búsqueda para acotar.
            </p>
          ) : null
        ) : (
          paginacion
        )}
      </div>
    </div>
  );
}
