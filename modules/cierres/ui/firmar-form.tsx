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
import { CircleAlert, PenLine, TriangleAlert } from "lucide-react";
import { firmarCierreAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { formatFechaIso } from "@/shared/format/fecha";
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
    <section className="panel" aria-labelledby="firmar-heading">
      <div className="panel-header flex items-center gap-3">
        <span className="tone-tile" data-tone={fueraDeTermino ? "danger" : "success"} aria-hidden>
          <PenLine />
        </span>
        <div>
          <h2 id="firmar-heading">Firmar jornada</h2>
          <p className="font-mono text-sm text-zinc-900 tabular-nums">{formatFechaIso(fecha)}</p>
        </div>
      </div>

      <div className="panel-body flex flex-col gap-4">
        {esJornadaActual ? (
          <div className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <div className="flex flex-col gap-2">
              <p className="font-semibold">Esta es la jornada de hoy.</p>
              <p>Una vez firmada, no se van a poder registrar más preparaciones, ajustes ni asientos con fecha de hoy. Lo que falte queda para la jornada siguiente.</p>
              {preparacionesIniciadas.length > 0 ? (
                <div>
                  <p className="font-medium">Preparaciones en curso ({preparacionesIniciadas.length}):</p>
                  <ul className="mt-1 list-inside list-disc">
                    {preparacionesIniciadas.map((p) => (
                      <li key={p.id}>{p.descripcion}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>No hay preparaciones iniciadas en este momento.</p>
              )}
              <label className="mt-1 flex items-start gap-2 font-medium">
                <input type="checkbox" className="mt-0.5" checked={confirmaAdvertencia} onChange={(e) => setConfirmaAdvertencia(e.target.checked)} />
                Entiendo la consecuencia y quiero firmar la jornada de hoy.
              </label>
            </div>
          </div>
        ) : null}

        {fueraDeTermino ? (
          <div className="alert alert-danger">
            <CircleAlert aria-hidden />
            <p>Esta firma queda fuera de término: indicá el motivo de la demora.</p>
          </div>
        ) : null}

        <SimpleForm action={firmarCierreAction} submitLabel="Firmar cierre" pendingLabel="Firmando…" submitVariant="critical" submitDisabled={!confirmaAdvertencia}>
          <input type="hidden" name="fecha" value={fecha} />

          {fueraDeTermino ? (
            <>
              <div className="field">
                <label htmlFor="motivoDemora" className="field-label">
                  Motivo de la demora
                </label>
                <select id="motivoDemora" name="motivoDemora" required value={motivoDemora} onChange={(e) => setMotivoDemora(e.target.value)} className="input">
                  <option value="">Seleccioná un motivo</option>
                  {MOTIVO_DEMORA_VALUES.map((value) => (
                    <option key={value} value={value}>
                      {MOTIVO_DEMORA_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
              {motivoDemora === "OTRO" ? (
                <div className="field">
                  <label htmlFor="motivoDemoraDetalle" className="field-label">
                    Detalle
                  </label>
                  <textarea id="motivoDemoraDetalle" name="motivoDemoraDetalle" required rows={2} className="input" />
                </div>
              ) : null}
            </>
          ) : null}

          <div className="field">
            <label htmlFor="password" className="field-label">
              Tu contraseña
            </label>
            <input id="password" name="password" type="password" autoComplete="off" required aria-describedby="password-ayuda" className="input" />
            <p id="password-ayuda" className="field-help">
              Se requiere tu contraseña completa. El PIN no es válido para firmar.
            </p>
          </div>
        </SimpleForm>
      </div>
    </section>
  );
}
