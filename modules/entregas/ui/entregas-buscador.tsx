"use client";

/** Search box + results table for `/entregas` (FASE 11, DP-24 discipline -- see buscar-entregas-action.ts's doc comment). Own copy per module, same shape as modules/pacientes/ui/pacientes-buscador.tsx. */
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { buscarEntregasAction } from "./buscar-entregas-action";
import type { BuscarEntregasState } from "./buscar-entregas-action";
import type { EntregaPendienteItem } from "@/modules/entregas/application/list-entregas-pendientes";

const ETIQUETA_ESTADO: Record<string, string> = {
  PREPARADA: "Preparada",
  LISTA_PARA_RETIRAR: "Lista para retirar",
  ENVIADA_PEND_FIRMA: "Enviada, pendiente de firma",
};

function BuscarButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">
      {pending ? "Buscando…" : "Buscar"}
    </button>
  );
}

export interface EntregasBuscadorProps {
  itemsIniciales: EntregaPendienteItem[];
  totalInicial: number;
}

export function EntregasBuscador({ itemsIniciales, totalInicial }: EntregasBuscadorProps) {
  const initialState: BuscarEntregasState = { status: "idle", items: itemsIniciales, total: totalInicial };
  const [state, formAction] = useActionState(buscarEntregasAction, initialState);

  return (
    <div>
      <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3" aria-label="Buscar entregas pendientes">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar por paciente
          </label>
          <input id="q" name="q" type="text" placeholder="Apellido o nombre" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <BuscarButton />
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {state.total} receta{state.total === 1 ? "" : "s"} pendiente{state.total === 1 ? "" : "s"} de entrega.
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Médico</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
            </tr>
          </thead>
          <tbody>
            {state.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-500">
                  No hay recetas pendientes de entrega.
                </td>
              </tr>
            ) : (
              state.items.map((r) => (
                <tr key={r.id} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="px-3 py-2">
                    <Link href={`/entregas/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.numeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.pacienteApellido}, {r.pacienteNombre}</td>
                  <td className="px-3 py-2">{r.medicoApellido}, {r.medicoNombre}</td>
                  <td className="px-3 py-2">{ETIQUETA_ESTADO[r.estado] ?? r.estado}</td>
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
