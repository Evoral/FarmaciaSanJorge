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
import { useActionState, useCallback, useRef, useState } from "react";
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

const numberFormat = new Intl.NumberFormat("es-AR");

function etiquetaEstado(estado: string): string {
  return Object.hasOwn(ESTADO_RECETA_LABELS, estado) ? ESTADO_RECETA_LABELS[estado as keyof typeof ESTADO_RECETA_LABELS] : estado;
}

export interface EntregasBuscadorProps {
  itemsIniciales: EntregaPendienteItem[];
  totalInicial: number;
}

export function EntregasBuscador({ itemsIniciales, totalInicial }: EntregasBuscadorProps) {
  const router = useRouter();
  const initialState: BuscarEntregasState = { status: "idle", items: itemsIniciales, total: totalInicial };
  const [state, formAction, isPending] = useActionState(buscarEntregasAction, initialState);
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
  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    const result = await buscarEntregasAction({ status: "idle", items: [], total: 0 }, formData);
    if (result.status === "error") throw new Error(result.message);
    return result.items.map((r) => ({
      value: r.id,
      label: `${r.pacienteNombre} ${r.pacienteApellido}`,
      description: `Nº ${r.numeroInterno} · ${etiquetaEstado(r.estado)}`,
    }));
  }, []);

  const buscando = state.status !== "idle";

  return (
    <div className="flex flex-col gap-4">
      <form ref={formRef} action={formAction} onSubmit={onSubmit} aria-label="Filtrar entregas pendientes" aria-busy={isPending} hidden>
        <input ref={qRef} type="hidden" name="q" defaultValue="" />
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
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      ) : null}

      <div className="list-panel transition-opacity" style={{ opacity: isPending ? 0.55 : 1 }}>
        <div className="list-toolbar">
          <p role="status">
            <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(state.total)}</span>{" "}
            {state.total === 1 ? "receta pendiente" : "recetas pendientes"} de entrega
            {busquedaAplicada ? <span className="text-zinc-500"> para “{busquedaAplicada}”</span> : null}
          </p>
          {isPending ? (
            <span className="flex items-center gap-2 text-xs">
              <span className="spinner" aria-hidden />
              Actualizando…
            </span>
          ) : null}
        </div>

        {state.items.length === 0 ? (
          buscando && busquedaAplicada ? (
            <EmptyState icon={<SearchX className="size-5" />} title="Sin resultados" description="Ninguna receta pendiente de entrega coincide con ese paciente." />
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
                {state.items.map((r) => {
                  const paciente = `${r.pacienteNombre} ${r.pacienteApellido}`;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5">
                        <Link href={`/entregas/${r.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                          {r.numeroInterno}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex items-center gap-2.5">
                          <Avatar name={paciente} />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-zinc-900">{paciente}</span>
                            <span className="block truncate text-xs text-zinc-500 md:hidden">
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
                          <span className="hidden sm:inline">Entregar</span>
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

        {state.total > state.items.length && busquedaAplicada ? (
          <p className="border-t border-zinc-100 px-4 py-2.5 text-xs text-zinc-500">
            Mostrando los primeros {state.items.length} resultados. Afiná la búsqueda para acotar.
          </p>
        ) : null}
      </div>
    </div>
  );
}
