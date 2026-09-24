"use client";

/** Search box (paciente + "solo vencidas") + results table for `/regularizacion` (FASE 11 point 11.3, DP-24 discipline -- see buscar-regularizacion-action.ts). */
import { useActionState } from "react";
import Link from "next/link";
import { useFormStatus } from "react-dom";
import { buscarRegularizacionAction } from "./buscar-regularizacion-action";
import type { BuscarRegularizacionState } from "./buscar-regularizacion-action";
import type { RegularizacionListItem } from "@/modules/entregas/application/list-regularizacion";

function BuscarButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-zinc-700">
      {pending ? "Buscando…" : "Buscar"}
    </button>
  );
}

export interface RegularizacionBuscadorProps {
  itemsIniciales: RegularizacionListItem[];
  totalInicial: number;
  plazoRegularizacionDias: number;
}

export function RegularizacionBuscador({ itemsIniciales, totalInicial, plazoRegularizacionDias }: RegularizacionBuscadorProps) {
  const initialState: BuscarRegularizacionState = { status: "idle", items: itemsIniciales, total: totalInicial, plazoRegularizacionDias };
  const [state, formAction] = useActionState(buscarRegularizacionAction, initialState);

  return (
    <div>
      <form action={formAction} className="mb-4 flex flex-wrap items-end gap-3" aria-label="Buscar recetas pendientes de regularizar">
        <div className="flex flex-col gap-1">
          <label htmlFor="q" className="text-sm font-medium">
            Buscar por paciente
          </label>
          <input id="q" name="q" type="text" placeholder="Apellido o nombre" className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="soloVencidas" />
          Solo vencidas
        </label>
        <BuscarButton />
      </form>

      {state.status === "error" ? (
        <p role="alert" className="mb-2 text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400" aria-live="polite">
        {state.total} receta{state.total === 1 ? "" : "s"} pendiente{state.total === 1 ? "" : "s"} de regularizar (plazo: {state.plazoRegularizacionDias} día
        {state.plazoRegularizacionDias === 1 ? "" : "s"}).
      </p>

      <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Nº</th>
              <th scope="col" className="px-3 py-2 font-medium">Paciente</th>
              <th scope="col" className="px-3 py-2 font-medium">Estado</th>
              <th scope="col" className="px-3 py-2 font-medium">Asiento más antiguo</th>
              <th scope="col" className="px-3 py-2 font-medium">Antigüedad</th>
            </tr>
          </thead>
          <tbody>
            {state.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No hay recetas pendientes de regularizar.
                </td>
              </tr>
            ) : (
              state.items.map((r) => (
                <tr
                  key={r.id}
                  className={
                    r.vencida
                      ? "border-b border-red-100 bg-red-50 last:border-0 dark:border-red-900 dark:bg-red-950"
                      : "border-b border-zinc-100 last:border-0 dark:border-zinc-900"
                  }
                >
                  <td className="px-3 py-2">
                    <Link href={`/recetas/${r.id}`} className="font-medium underline-offset-2 hover:underline">
                      {r.numeroInterno}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.pacienteApellido}, {r.pacienteNombre}</td>
                  <td className="px-3 py-2">{r.estado}</td>
                  <td className="px-3 py-2">{r.fechaAsientoMasAntiguo}</td>
                  <td className="px-3 py-2">
                    {r.antiguedadDias} día{r.antiguedadDias === 1 ? "" : "s"}
                    {r.vencida ? <span className="ml-2 rounded border border-red-300 bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800 dark:border-red-800 dark:bg-red-900 dark:text-red-200">Vencida</span> : null}
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
