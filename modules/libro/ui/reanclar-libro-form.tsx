"use client";

/**
 * `/libro/integridad` re-anchor form (migration 0087). Rendered only for a libro whose chain is broken and a session
 * holding `libro.anulacion.autorizar` (the DT). The motivo is mandatory; the DT's own re-auth is handled by
 * `ReauthAwareForm`.
 */
import { TriangleAlert } from "lucide-react";
import { reanclarLibroAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

export interface ReanclarLibroFormProps {
  libroId: string;
  etiquetaLibro: string;
  numeroFaltante: string;
}

export function ReanclarLibroForm({ libroId, etiquetaLibro, numeroFaltante }: ReanclarLibroFormProps) {
  const headingId = `reanclar-${libroId}`;
  return (
    <section className="panel" data-tone="danger" aria-labelledby={headingId}>
      <div className="panel-header">
        <h2 id={headingId}>Reanclar la cadena · {etiquetaLibro}</h2>
      </div>
      <div className="panel-body flex flex-col gap-4">
        <div className="alert alert-danger">
          <TriangleAlert aria-hidden />
          <p>
            Falta el asiento Nº {numeroFaltante}. Antes de continuar, revisá la sección de Auditoría y confirmá que fue una baja que conocés. Reanclar acepta
            solo este faltante: no renumera ni recalcula nada, queda registrado con tu nombre y no se puede deshacer. Si el contenido de un asiento fue
            alterado, esta acción no corresponde: contactá a soporte.
          </p>
        </div>
        <ReauthAwareForm action={reanclarLibroAction} submitLabel="Reanclar la cadena" pendingLabel="Reanclando…" submitVariant="danger-solid">
          <input type="hidden" name="libroId" value={libroId} />
          <div className="field">
            <label htmlFor={`motivo-${libroId}`} className="field-label">
              Motivo
            </label>
            <textarea id={`motivo-${libroId}`} name="motivo" required rows={2} className="input" />
          </div>
        </ReauthAwareForm>
      </div>
    </section>
  );
}
