"use client";

/**
 * Search box + results table for `/catalogos/pacientes` (FASE 4 point 4.5,
 * DP-24). Submits via `useActionState` (a Server Action RPC call, NOT a
 * `<form method="get">` page navigation) so the search term (apellido or
 * DNI -- both identifying) never appears in the URL/query string. Starts
 * from the server-rendered `itemsIniciales`/`totalInicial` (the page's own
 * default, non-identifying `estado`-filtered listing) and replaces them
 * with the search action's result once the person searches.
 */
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { buscarPacientesAction } from "./buscar-pacientes-action";
import type { BuscarPacientesState, PacienteListItem } from "./buscar-pacientes-action";

function BuscarButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">
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
  const [state, formAction] = useActionState(buscarPacientesAction, initialState);

  return (
    <div>
      <form action={formAction} className="mb-6 flex flex-wrap items-end gap-3" aria-label="Buscar pacientes">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar (apellido o DNI)
          </label>
          <input id="q" name="q" type="text" placeholder="Apellido o DNI" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <input type="hidden" name="estado" value={estado} />
        <BuscarButton />
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {state.total} paciente{state.total === 1 ? "" : "s"} encontrado{state.total === 1 ? "" : "s"}.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Apellido y nombre</th>
              <th scope="col" className="px-3 py-2 font-medium">DNI</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {state.items.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                  No se encontraron pacientes con estos filtros.
                </td>
              </tr>
            ) : (
              state.items.map((paciente) => (
                <tr key={paciente.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/catalogos/pacientes/${paciente.id}`} className="font-medium underline-offset-2 hover:underline">
                      {paciente.apellido}, {paciente.nombre}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{paciente.dni ?? "—"}</td>
                  <td className="px-3 py-2">{paciente.fechaBaja ? "Baja" : "Vigente"}</td>
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
