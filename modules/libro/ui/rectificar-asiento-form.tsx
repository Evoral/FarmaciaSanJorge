"use client";

/**
 * `/libro/[id]` rectificativo form -- D1 (2026-09-23). Same "co-firma en
 * el mismo acto" shape as `AnularAsientoForm`; only rendered by the caller
 * for a SISTEMA asiento whose jornada is ALREADY signed, still VIGENTE,
 * and with no rectificativo yet (see `app/(app)/libro/[id]/page.tsx`).
 */
import { TriangleAlert } from "lucide-react";
import { rectificarAsientoAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import type { DtOpcion } from "./anular-asiento-form";

export interface RectificarAsientoFormProps {
  asientoOriginalId: string;
  numeroCorrelativo: string;
  dts: DtOpcion[];
}

export function RectificarAsientoForm({ asientoOriginalId, numeroCorrelativo, dts }: RectificarAsientoFormProps) {
  return (
    <section className="panel" data-tone="danger" aria-labelledby="rectificar-heading">
      <div className="panel-header">
        <h2 id="rectificar-heading">Rectificar asiento Nº {numeroCorrelativo}</h2>
      </div>
      <div className="panel-body flex flex-col gap-4">
        <div className="alert alert-warn">
          <TriangleAlert aria-hidden />
          <p>
            La jornada de este asiento ya está firmada: no se puede anular. Se genera un asiento rectificativo nuevo, en la jornada de hoy, que deja este
            asiento &quot;sin efecto&quot;. El original no se modifica ni se borra.
          </p>
        </div>
        <ReauthAwareForm action={rectificarAsientoAction} submitLabel="Generar rectificativo" pendingLabel="Generando…" submitVariant="danger-solid">
          <input type="hidden" name="asientoOriginalId" value={asientoOriginalId} />
          <div className="field">
            <label htmlFor="motivo-rectificar" className="field-label">
              Motivo
            </label>
            <textarea id="motivo-rectificar" name="motivo" required rows={2} className="input" />
          </div>
          <CoFirmaDt dts={dts} idSuffix="-rectificar" />
        </ReauthAwareForm>
      </div>
    </section>
  );
}
