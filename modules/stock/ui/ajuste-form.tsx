"use client";

/**
 * `/stock/ajustes/nuevo` form (FASE 5 point 5.4, DP-08b RESUELTA). The DT
 * co-signature is built into this SAME form (co-firma en el mismo acto):
 * the operator fills in the ajuste, and the DT types THEIR OWN password
 * right below, in the same submit -- `registrarAjusteAction`
 * (modules/stock/ui/actions.ts) verifies it server-side before writing
 * anything.
 *
 * "Cantidad a descontar" is typed in the unit picked next to it (`unidadId`:
 * the practical units of the droga's magnitude, or just its unidad base when
 * that is not convertible); the server validates the unit and converts the
 * quantity to the unidad base (modules/stock/application/registrar-ajuste.ts).
 */
import { useRouter } from "next/navigation";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import { registrarAjusteAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { MOTIVOS_AJUSTE, MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";

export interface DtOpcion {
  id: string;
  label: string;
}

export interface UnidadAjusteOpcion {
  id: string;
  simbolo: string;
}

export interface AjusteFormProps {
  partidaId: string;
  drogaNombre: string;
  lote: string;
  /**
   * The balance as EXACT equivalences in practical units (see
   * shared/format/cantidad.ts#equivalenciasPracticas), e.g. "500 g" and
   * "500.000 mg": the user compares it with what they type, so it is never
   * rounded. `secundario` is `null` for a non-convertible unidad base.
   */
  saldoPrincipal: string;
  saldoSecundario: string | null;
  /** Units `cantidad` may be entered in. A single entry renders as a fixed symbol, not a picker. */
  unidades: UnidadAjusteOpcion[];
  /** Preselected unit: the one `saldoPrincipal` is expressed in. */
  unidadPorDefectoId: string;
  dts: DtOpcion[];
  /** `true` when the OPERATOR is themselves a vigente DT -- INV-U06: they still type their own password, and both `registradoPorId`/`autorizadoPorId` end up holding the same id. */
  operadorEsDt: boolean;
}

/** Once saved, the ajustes list: the new ajuste is its first row, under a success banner. */
const REGISTRADO_HREF = "/stock/ajustes?registrado=1";

export function AjusteForm({
  partidaId,
  drogaNombre,
  lote,
  saldoPrincipal,
  saldoSecundario,
  unidades,
  unidadPorDefectoId,
  dts,
  operadorEsDt,
}: AjusteFormProps) {
  const router = useRouter();
  const unidadFija = unidades.length === 1 ? unidades[0]! : null;

  return (
    <div className="panel max-w-2xl">
      <div className="border-b border-zinc-100 p-5">
        <p className="text-sm font-medium text-zinc-900">{drogaNombre}</p>
        <p className="text-xs text-zinc-500">
          Lote <span className="font-mono">{lote}</span> · Saldo disponible
        </p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-zinc-900 tabular-nums">
          {saldoPrincipal}
          {saldoSecundario ? <span className="ml-3 text-base font-normal text-zinc-500">{saldoSecundario}</span> : null}
        </p>
      </div>

      <div className="panel-body">
        <SimpleForm action={registrarAjusteAction} submitLabel="Registrar ajuste" onSuccess={() => router.push(REGISTRADO_HREF)}>
          <input type="hidden" name="partidaId" value={partidaId} />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="cantidad" className="field-label">
                Cantidad a descontar
              </label>
              <div className="flex items-center gap-2">
                <input id="cantidad" name="cantidad" type="text" inputMode="decimal" required className="input min-w-0 flex-1 font-mono" />
                {unidadFija ? (
                  <>
                    <input type="hidden" name="unidadId" value={unidadFija.id} />
                    <span className="text-sm font-medium text-zinc-700">{unidadFija.simbolo}</span>
                  </>
                ) : (
                  <select id="unidadId" name="unidadId" required defaultValue={unidadPorDefectoId} aria-label="Unidad de la cantidad a descontar" className="input w-24">
                    {unidades.map((unidad) => (
                      <option key={unidad.id} value={unidad.id}>
                        {unidad.simbolo}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <div className="field">
              <label htmlFor="motivoAjuste" className="field-label">
                Motivo
              </label>
              <select id="motivoAjuste" name="motivoAjuste" required className="input">
                <option value="">Seleccioná un motivo</option>
                {MOTIVOS_AJUSTE.map((motivo) => (
                  <option key={motivo} value={motivo}>
                    {MOTIVO_AJUSTE_LABELS[motivo]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="observacion" className="field-label">
              Observación
            </label>
            <textarea id="observacion" name="observacion" required rows={2} className="input" />
          </div>

          <CoFirmaDt dts={dts} operadorEsDt={operadorEsDt} />
        </SimpleForm>
      </div>
    </div>
  );
}
