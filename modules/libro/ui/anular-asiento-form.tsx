"use client";

/**
 * `/libro/[id]` anulación form (FASE 9, M12 point 9.2). Same "co-firma en
 * el mismo acto" shape as `modules/stock/ui/ajuste-form.tsx`: the requester
 * fills in the motivo (their OWN step-up re-auth is handled by
 * `ReauthAwareForm`), and the DT types their own password right below --
 * `anularAsientoAction` verifies it server-side (via
 * `verificarCoFirmaDtLibro`) before writing anything. Only rendered by the
 * caller for a VIGENTE asiento whose jornada is not signed and whose
 * session holds `libro.anulacion.solicitar` (see `app/(app)/libro/[id]/page.tsx`).
 */
import { anularAsientoAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";

export interface DtOpcion {
  id: string;
  label: string;
}

export interface AnularAsientoFormProps {
  asientoId: string;
  numeroCorrelativo: string;
  dts: DtOpcion[];
}

export function AnularAsientoForm({ asientoId, numeroCorrelativo, dts }: AnularAsientoFormProps) {
  return (
    <div className="rounded border border-red-300 p-4 dark:border-red-800">
      <h3 className="mb-2 text-sm font-semibold text-red-800 dark:text-red-300">Anular asiento Nº {numeroCorrelativo}</h3>
      <p className="mb-3 text-xs text-zinc-600 dark:text-zinc-400">Esta acción es irreversible. El asiento queda ANULADO; su egreso de stock se mantiene (INV-L20).</p>

      <ReauthAwareForm action={anularAsientoAction} submitLabel="Anular asiento" pendingLabel="Anulando…" className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="asientoId" value={asientoId} />

        <div className="flex flex-col gap-1">
          <label htmlFor="motivo" className="text-sm font-medium">
            Motivo
          </label>
          <textarea id="motivo" name="motivo" required rows={2} className="input" />
        </div>

        <fieldset className="card p-4">
          <legend className="px-1 text-sm font-medium">Co-firma del Director Técnico</legend>
          <div className="flex flex-col gap-1">
            <label htmlFor="dtUsuarioId" className="text-sm font-medium">
              Director Técnico
            </label>
            <select id="dtUsuarioId" name="dtUsuarioId" required className="input">
              <option value="">Seleccioná el DT que autoriza</option>
              {dts.map((dt) => (
                <option key={dt.id} value={dt.id}>
                  {dt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-2 flex flex-col gap-1">
            <label htmlFor="dtPassword" className="text-sm font-medium">
              Contraseña del Director Técnico
            </label>
            <input
              id="dtPassword"
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
