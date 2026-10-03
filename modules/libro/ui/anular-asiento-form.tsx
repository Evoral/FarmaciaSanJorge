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
import { TriangleAlert } from "lucide-react";
import { anularAsientoAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CoFirmaDt, type CoFirmaDtOpcion } from "@/shared/ui/co-firma-dt";

export type DtOpcion = CoFirmaDtOpcion;

export interface AnularAsientoFormProps {
  asientoId: string;
  numeroCorrelativo: string;
  dts: DtOpcion[];
}

export function AnularAsientoForm({ asientoId, numeroCorrelativo, dts }: AnularAsientoFormProps) {
  return (
    <section className="panel" data-tone="danger" aria-labelledby="anular-heading">
      <div className="panel-header">
        <h2 id="anular-heading">Anular asiento Nº {numeroCorrelativo}</h2>
      </div>
      <div className="panel-body flex flex-col gap-4">
        <div className="alert alert-danger">
          <TriangleAlert aria-hidden />
          <p>Esta acción es irreversible. El asiento queda anulado; su egreso de stock se mantiene.</p>
        </div>
        <ReauthAwareForm action={anularAsientoAction} submitLabel="Anular asiento" pendingLabel="Anulando…" submitVariant="danger-solid">
          <input type="hidden" name="asientoId" value={asientoId} />
          <div className="field">
            <label htmlFor="motivo" className="field-label">
              Motivo
            </label>
            <textarea id="motivo" name="motivo" required rows={2} className="input" />
          </div>
          <CoFirmaDt dts={dts} />
        </ReauthAwareForm>
      </div>
    </section>
  );
}
