"use client";

/**
 * Search box + results table for `/pacientes` (FASE 4 point 4.5,
 * DP-24). Submits via `useActionState` (a Server Action RPC call, NOT a
 * `<form method="get">` page navigation) so the search term (apellido or
 * DNI -- both identifying) never appears in the URL/query string. Starts
 * from the server-rendered `itemsIniciales`/`totalInicial` (the page's own
 * default, non-identifying `estado`-filtered listing) and replaces them
 * with the search action's result once the person searches.
 */
import { useActionState } from "react";
import Link from "next/link";
import { buscarPacientesAction } from "./buscar-pacientes-action";
import type { BuscarPacientesState, PacienteListItem } from "./buscar-pacientes-action";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

function BuscarButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="btn btn-secondary">
      {pending ? "Buscando…" : "Buscar"}
    </button>
  );
}

export interface PacientesBuscadorProps {
  itemsIniciales: PacienteListItem[];
  totalInicial: number;
  estado: string;
}

export function PacientesBuscador({ itemsIniciales, totalInicial, estado }: PacientesBuscadorProps) {
  const initialState: BuscarPacientesState = { status: "idle", items: itemsIniciales, total: totalInicial };
  const [state, formAction, isPending] = useActionState(buscarPacientesAction, initialState);
  // Not reset on success: the search criteria stay next to their results.
  const { onSubmit } = useFormSubmit(formAction);

  return (
    <div>
      <form action={formAction} onSubmit={onSubmit} className="mb-6 flex flex-wrap items-end gap-3" aria-label="Buscar pacientes">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar (apellido o DNI)
          </label>
          <input id="q" name="q" type="text" placeholder="Apellido o DNI" className="input" />
        </div>
        <input type="hidden" name="estado" value={estado} />
        <BuscarButton pending={isPending} />
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {state.total} paciente{state.total === 1 ? "" : "s"} encontrado{state.total === 1 ? "" : "s"}.
      </p>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nombre y apellido</th>
              <th scope="col" className="px-3 py-2 font-medium">DNI</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {state.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron pacientes con estos filtros.
                </td>
              </tr>
            ) : (
              state.items.map((paciente) => (
                <tr key={paciente.id}>
                  <td className="px-3 py-2">
                    <Link href={`/pacientes/${paciente.id}`} className="font-medium underline-offset-2 hover:underline">
                      {paciente.nombre} {paciente.apellido}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{paciente.dni ?? "—"}</td>
                  <td className="px-3 py-2">{paciente.fechaBaja ? "Baja" : "Vigente"}</td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/pacientes/${paciente.id}/trayectoria`} className="btn btn-secondary btn-sm" aria-label={`Ver trayectoria de ${paciente.nombre} ${paciente.apellido}`}>
                      Trayectoria
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {state.total > state.items.length ? (
        <p className="mt-2 text-sm text-zinc-500">Mostrando los primeros {state.items.length} resultados -- afiná la búsqueda para acotar.</p>
      ) : null}
    </div>
  );
}
