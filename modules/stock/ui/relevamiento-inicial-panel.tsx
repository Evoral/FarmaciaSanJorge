"use client";

/**
 * Relevamiento inicial on /partidas/ingresar (openspec/specs/existencia-inicial/spec.md
 * R6-R8): whether existencia inicial can still be loaded and until when, what
 * was loaded per droga, the controlled drogas whose libro contralor does not
 * match their stock, and -- for the DT vigente only -- "Cerrar relevamiento"
 * with their own password. The existencia inicial form goes inside it
 * (`children`). Rendered only while the relevamiento is open: once closed the
 * page shows nothing of it (the close stays in the audit).
 */
import type { ReactNode } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { formatFechaIso } from "@/shared/format/fecha";
import { formatCantidadExacta } from "@/shared/format/cantidad";
import { cerrarRelevamientoInicialAction } from "./actions";
import { PasswordInput } from "@/shared/ui/password-input";

export interface RelevamientoInicialPanelProps {
  /** `YYYY-MM-DD`, `null` while no cierre diario is signed. */
  fechaLimite: string | null;
  cargadoPorDroga: readonly { drogaId: string; drogaNombre: string; partidas: number }[];
  contralorActivo: boolean;
  diferencias: readonly { drogaId: string; drogaNombre: string; unidadSimbolo: string; saldoContralor: string | null; stockFisico: string }[];
  puedeCerrar: boolean;
  children?: ReactNode;
}

export function RelevamientoInicialPanel({
  fechaLimite,
  cargadoPorDroga,
  contralorActivo,
  diferencias,
  puedeCerrar,
  children,
}: RelevamientoInicialPanelProps) {
  const partidas = cargadoPorDroga.reduce((total, d) => total + d.partidas, 0);

  return (
    <section className="panel">
      <div className="panel-body flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold">Existencia inicial</h2>
          <p className="text-sm text-zinc-500">
            Cargá cada envase que ya estaba en la farmacia al empezar a usar el sistema: lote, vencimiento y cantidad, como figuran en el envase. Se puede
            hasta que el Director Técnico cierre el relevamiento
            {fechaLimite ? `, como máximo hasta el ${formatFechaIso(fechaLimite)}` : " (el plazo empieza a correr con el primer cierre diario firmado)"}.
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {partidas === 0
              ? "Todavía no se cargó ningún envase."
              : `Cargados: ${partidas === 1 ? "1 envase" : `${partidas} envases`} de ${cargadoPorDroga.length === 1 ? "1 droga" : `${cargadoPorDroga.length} drogas`}.`}
          </p>
        </div>

        {children}

        {contralorActivo && diferencias.length > 0 ? (
          <div role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">El libro contralor no coincide con el stock de estas drogas controladas:</p>
            <ul className="mt-1 list-disc pl-5">
              {diferencias.map((d) => (
                <li key={d.drogaId}>
                  {d.drogaNombre}: contralor {d.saldoContralor === null ? "sin apertura" : formatCantidadExacta(d.saldoContralor, d.unidadSimbolo)}, stock{" "}
                  {formatCantidadExacta(d.stockFisico, d.unidadSimbolo)}
                </li>
              ))}
            </ul>
            <p className="mt-1">Hasta que coincidan no se puede cerrar el relevamiento.</p>
          </div>
        ) : null}

        {puedeCerrar ? (
          <div className="border-t border-zinc-200 pt-4">
            <h3 className="text-sm font-semibold">Cerrar relevamiento</h3>
            <p className="mb-2 text-sm text-zinc-500">
              Al cerrarlo ya no se puede cargar existencia inicial, y no se vuelve a abrir. Desde entonces el stock entra solo por compras.
            </p>
            <SimpleForm action={cerrarRelevamientoInicialAction} submitLabel="Cerrar relevamiento" submitVariant="secondary" className="max-w-sm">
              <div className="field">
                <label htmlFor="relevamiento-password" className="field-label">
                  Tu contraseña (Director Técnico)
                </label>
                <PasswordInput id="relevamiento-password" name="password" autoComplete="current-password" required className="input" />
              </div>
            </SimpleForm>
          </div>
        ) : null}
      </div>
    </section>
  );
}
