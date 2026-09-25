"use client";

/**
 * `/libro/[id]` rectificativo form -- D1 (2026-09-23). Same "co-firma en
 * el mismo acto" shape as `AnularAsientoForm`; only rendered by the caller
 * for a SISTEMA asiento whose jornada is ALREADY signed, still VIGENTE,
 * and with no rectificativo yet (see `app/(app)/libro/[id]/page.tsx`).
 */
import { rectificarAsientoAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";
import type { DtOpcion } from "./anular-asiento-form";

export interface RectificarAsientoFormProps {
  asientoOriginalId: string;
  numeroCorrelativo: string;
  dts: DtOpcion[];
}

export function RectificarAsientoForm({ asientoOriginalId, numeroCorrelativo, dts }: RectificarAsientoFormProps) {
  return (
    <div className="rounded border border-amber-300 p-4 dark:border-amber-800">
      <h3 className="mb-2 text-sm font-semibold text-amber-800 dark:text-amber-300">Rectificar asiento Nº {numeroCorrelativo}</h3>
      <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">
        La jornada de este asiento ya está firmada: no se puede anular. Se generará un asiento rectificativo nuevo, en la jornada de hoy, que deja este asiento &quot;sin efecto&quot; -- el original NO se modifica ni se borra (INV-L01/L18).
      </p>

      <ReauthAwareForm action={rectificarAsientoAction} submitLabel="Generar rectificativo" pendingLabel="Generando…" className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="asientoOriginalId" value={asientoOriginalId} />

        <div className="flex flex-col gap-1">
          <label htmlFor="motivo-rectificar" className="text-sm font-medium">
            Motivo
          </label>
          <textarea id="motivo-rectificar" name="motivo" required rows={2} className="input" />
        </div>

        <fieldset className="card p-4">
          <legend className="px-1 text-sm font-medium">Co-firma del Director Técnico</legend>
          <div className="flex flex-col gap-1">
            <label htmlFor="dtUsuarioId-rectificar" className="text-sm font-medium">
              Director Técnico
            </label>
            <select id="dtUsuarioId-rectificar" name="dtUsuarioId" required className="input">
              <option value="">Seleccioná el DT que autoriza</option>
              {dts.map((dt) => (
                <option key={dt.id} value={dt.id}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <label htmlFor="dtPassword-rectificar" className="text-sm font-medium">
              Contraseña del Director Técnico
            </label>
            <input
              id="dtPassword-rectificar"
              name="dtPassword"
              type="password"
              autoComplete="off"
              required
              className="input"
            />
          </div>
        </fieldset>
      </ReauthAwareForm>
    </div>
  );
}
