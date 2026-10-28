"use client";

/**
 * `/cierres` firma form (FASE 10, M13a point 10.1). Only the OLDEST pending
 * jornada can be signed (chronological order, INV-C19 is the real
 * backstop) -- the caller only renders this for that one fecha. Shows the
 * motivo-de-demora fields only when `fueraDeTermino` (server-computed via
 * `../domain/demora.ts#calcularFueraDeTermino`) is true. The jornada in
 * progress is never offered (DP-18b revised, migration 0075: the cierre
 * diario is signed the day after).
 *
 * Migration 0097 (INV-L26): when this cierre is the first to cover a libro's asientos, it fixes that libro's first
 * number for good. The DT then confirms the number each libro starts at (mandatory checkbox, the shown numbers travel
 * as hidden fields and are re-checked server-side), with a link to `/libro/numeracion` to change it first.
 */
import { useState } from "react";
import Link from "next/link";
import { CircleAlert, Hash, PenLine } from "lucide-react";
import { firmarCierreAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { MOTIVO_DEMORA_VALUES, MOTIVO_DEMORA_LABELS } from "../domain/motivo-demora";
import { PasswordInput } from "@/shared/ui/password-input";

export interface NumeracionPorConfirmar {
  libroId: string;
  etiquetaLibro: string;
  numeroInicial: string;
}

export interface FirmarFormProps {
  fecha: string;
  fueraDeTermino: boolean;
  /** Libros whose numbering this cierre fixes (empty after the first cierre of every libro). */
  numeracionPorConfirmar: NumeracionPorConfirmar[];
}

export function FirmarForm({ fecha, fueraDeTermino, numeracionPorConfirmar }: FirmarFormProps) {
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

        <SimpleForm action={firmarCierreAction} submitLabel="Firmar cierre" pendingLabel="Firmando…" submitVariant="primary">
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

          {numeracionPorConfirmar.length > 0 ? (
            <div className="alert alert-warn flex-col items-stretch gap-3">
              <div className="flex gap-2">
                <Hash className="size-4 flex-none" aria-hidden />
                <div className="flex flex-col gap-1">
                  <p className="font-medium">Este cierre deja fija la numeración del libro.</p>
                  <ul className="flex flex-col gap-0.5">
                    {numeracionPorConfirmar.map((l) => (
                      <li key={l.libroId}>
                        {l.etiquetaLibro}: el primer asiento será el <span className="font-mono font-semibold tabular-nums">Nº {l.numeroInicial}</span>.
                        <input type="hidden" name="numeracion" value={`${l.libroId}:${l.numeroInicial}`} />
                      </li>
                    ))}
                  </ul>
                  <p>Después de firmar no se puede cambiar.</p>
                  <p>
                    ¿No es así?{" "}
                    <Link href="/libro/numeracion" className="font-medium underline underline-offset-2">
                      Ir a Numeración del libro
                    </Link>
                  </p>
                </div>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" id="confirmaNumeracion" name="confirmaNumeracion" required className="mt-0.5 size-4 flex-none" />
                <span>Confirmo la numeración y entiendo que no se podrá cambiar.</span>
              </label>
            </div>
          ) : null}

          <div className="field">
            <label htmlFor="password" className="field-label">
              Tu contraseña
            </label>
            <PasswordInput id="password" name="password" autoComplete="off" required aria-describedby="password-ayuda" className="input" />
            <p id="password-ayuda" className="field-help">
              Se requiere tu contraseña completa. El PIN no es válido para firmar.
            </p>
          </div>
        </SimpleForm>
      </div>
    </section>
  );
}
