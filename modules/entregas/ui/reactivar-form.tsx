"use client";

/**
 * "Reactivar" a RETIRO_VENCIDO receta (docs/specs/retiro-vencido.md RV4-RV6): it goes back to Preparada and can be
 * delivered as always. When a preparado is already vencido the same form carries the Director Técnico's co-firma (the DT
 * picks themselves and types their own password); the use case decides whether it is needed, this form only mirrors what
 * it will ask. Same `SimpleForm` shape as the other entrega forms: what the user typed survives an error, and on success
 * the receta's estado flips, so the pop-up's props change and the normal entrega form takes this one's place.
 */
import { TriangleAlert } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CoFirmaDt, type CoFirmaDtOpcion } from "@/shared/ui/co-firma-dt";
import { formatFechaIso } from "@/shared/format/fecha";
import type { EntregaActionState } from "./action-state";

export interface PreparadoVencidoAviso {
  etiqueta: string;
  /** `YYYY-MM-DD` */
  fechaVencimiento: string;
}

export interface ReactivarFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The jornada (YYYY-MM-DD) the retiro plazo expired on; null when it can not be told (the parameter is 0 now). */
  vencioEl: string | null;
  diasRetiroVencido: number;
  /** Preparados already vencidos: each one is warned about and, together, they make the DT's co-firma required. */
  preparadosVencidos: readonly PreparadoVencidoAviso[];
  dts: readonly CoFirmaDtOpcion[];
  /** The operator is themselves a vigente DT (they still type their own password). */
  operadorEsDt: boolean;
}

/** "El plazo de retiro venció el dd/mm/aaaa (N días desde que quedó preparada)." */
export function textoPlazoVencido(vencioEl: string | null, diasRetiroVencido: number): string {
  if (vencioEl === null) return "El plazo de retiro venció.";
  const dias = `${diasRetiroVencido} ${diasRetiroVencido === 1 ? "día" : "días"}`;
  return `El plazo de retiro venció el ${formatFechaIso(vencioEl)} (${dias} desde que quedó preparada).`;
}

export function ReactivarForm({ action, recetaId, vencioEl, diasRetiroVencido, preparadosVencidos, dts, operadorEsDt }: ReactivarFormProps) {
  const requiereCoFirma = preparadosVencidos.length > 0;
  const sinDt = requiereCoFirma && dts.length === 0;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-700">{textoPlazoVencido(vencioEl, diasRetiroVencido)}</p>
      <p className="text-[0.8125rem] leading-relaxed text-zinc-600">Al reactivarla, la receta vuelve a Preparada y el plazo de retiro empieza de nuevo.</p>
      <SimpleForm
        action={action}
        accion="entregas.registrar"
        submitLabel="Reactivar"
        pendingLabel="Reactivando…"
        submitDisabled={sinDt}
        submitDisabledReason="No hay un Director Técnico vigente que pueda autorizarlo."
      >
        <input type="hidden" name="recetaId" value={recetaId} />
        {requiereCoFirma ? (
          <>
            <div role="note" className="alert alert-danger">
              <TriangleAlert aria-hidden />
              <div className="flex flex-col gap-1">
                {preparadosVencidos.map((preparado, indice) => (
                  <p key={`${indice}-${preparado.fechaVencimiento}`}>
                    <strong className="font-semibold">{preparado.etiqueta}.</strong> El preparado venció el {formatFechaIso(preparado.fechaVencimiento)}: no se recomienda entregarlo.
                  </p>
                ))}
                <p>Para reactivarla hace falta la autorización del Director Técnico.</p>
              </div>
            </div>
            <CoFirmaDt dts={dts} operadorEsDt={operadorEsDt} />
          </>
        ) : null}
      </SimpleForm>
    </div>
  );
}
