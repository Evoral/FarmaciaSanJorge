"use client";

/**
 * `/cierres` firma form (FASE 10, M13a point 10.1). Only the OLDEST pending
 * jornada can be signed (chronological order, INV-C19 is the real
 * backstop) -- the caller only renders this for that one fecha. Shows the
 * motivo-de-demora fields only when `fueraDeTermino` (server-computed via
 * `../domain/demora.ts#calcularFueraDeTermino`) is true. The jornada in
 * progress is never offered (DP-18b revised, migration 0075: the cierre
 * diario is signed the day after).
 */
import { useState } from "react";
import { CircleAlert, PenLine } from "lucide-react";
import { firmarCierreAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { MOTIVO_DEMORA_VALUES, MOTIVO_DEMORA_LABELS } from "../domain/motivo-demora";

export interface FirmarFormProps {
  fecha: string;
  fueraDeTermino: boolean;
}

export function FirmarForm({ fecha, fueraDeTermino }: FirmarFormProps) {
  const [motivoDemora, setMotivoDemora] = useState("");

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
        {fueraDeTermino ? (
          <div className="alert alert-danger">
            <CircleAlert aria-hidden />
            <p>Esta firma queda fuera de término: indicá el motivo de la demora.</p>
          </div>
        ) : null}

        <SimpleForm action={firmarCierreAction} submitLabel="Firmar cierre" pendingLabel="Firmando…" submitVariant="critical">
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
