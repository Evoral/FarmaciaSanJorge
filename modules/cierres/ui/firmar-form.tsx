"use client";

/**
 * `/cierres` firma form (FASE 10, M13a point 10.1). Only the OLDEST pending
 * jornada can be signed (chronological order, INV-C19 is the real
 * backstop) -- the caller only renders this for that one fecha. Shows the
 * motivo-de-demora fields only when `fueraDeTermino` (server-computed via
 * `../domain/demora.ts#calcularFueraDeTermino`) is true, and DP-18b's
 * explicit warning + today's `INICIADA` preparaciones when `fecha` IS the
 * tenant's current jornada.
 */
import { useState } from "react";
import { firmarCierreAction } from "./actions";
import { SimpleForm } from "./simple-form";
import { MOTIVO_DEMORA_VALUES, MOTIVO_DEMORA_LABELS } from "../domain/motivo-demora";

export interface PreparacionIniciadaResumen {
  id: string;
  descripcion: string;
}

export interface FirmarFormProps {
  fecha: string;
  fueraDeTermino: boolean;
  esJornadaActual: boolean;
  preparacionesIniciadas: PreparacionIniciadaResumen[];
}

export function FirmarForm({ fecha, fueraDeTermino, esJornadaActual, preparacionesIniciadas }: FirmarFormProps) {
  const [motivoDemora, setMotivoDemora] = useState("");
  const [confirmaAdvertencia, setConfirmaAdvertencia] = useState(!esJornadaActual);

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Firmar jornada {fecha}</h3>

      {esJornadaActual ? (
        <div className="mb-4 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          <p className="mb-2 font-medium">Esta es la jornada de hoy.</p>
          <p className="mb-2">
            Una vez firmada, no se van a poder registrar más preparaciones, ajustes ni asientos con fecha de hoy (INV-C03). Lo que falte
            queda para la jornada siguiente.
          </p>
          {preparacionesIniciadas.length > 0 ? (
            <>
              <p className="mb-1 font-medium">Preparaciones en curso (estado INICIADA):</p>
              <ul className="mb-2 list-inside list-disc">
                {preparacionesIniciadas.map((p) => (
                  <li key={p.id}>{p.descripcion}</li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mb-2">No hay preparaciones en estado INICIADA en este momento.</p>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmaAdvertencia} onChange={(e) => setConfirmaAdvertencia(e.target.checked)} />
            Entiendo la consecuencia y quiero firmar la jornada de hoy.
          </label>
        </div>
      ) : null}

      {fueraDeTermino ? (
        <p className="mb-3 text-sm text-red-700 dark:text-red-400">Esta firma queda fuera de término: indicá el motivo de la demora.</p>
      ) : null}

      <SimpleForm action={firmarCierreAction} submitLabel="Firmar cierre" pendingLabel="Firmando…" submitDisabled={!confirmaAdvertencia} className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="fecha" value={fecha} />

        {fueraDeTermino ? (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor="motivoDemora" className="text-sm font-medium">
                Motivo de la demora
              </label>
              <select
                id="motivoDemora"
                name="motivoDemora"
                required
                value={motivoDemora}
                onChange={(e) => setMotivoDemora(e.target.value)}
                className="input"
              >
                <option value="">Seleccioná un motivo</option>
                {MOTIVO_DEMORA_VALUES.map((value) => (
                  <option key={value} value={value}>
                    {MOTIVO_DEMORA_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
            {motivoDemora === "OTRO" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="motivoDemoraDetalle" className="text-sm font-medium">
                  Detalle
                </label>
                <textarea
                  id="motivoDemoraDetalle"
                  name="motivoDemoraDetalle"
                  required
                  rows={2}
                  className="input"
                />
              </div>
            ) : null}
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm font-medium">
            Tu contraseña
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="off"
            required
            className="input"
          />
          <p className="text-xs text-zinc-500">Se requiere tu contraseña completa. El PIN no es válido para firmar.</p>
        </div>
      </SimpleForm>
    </div>
  );
}
