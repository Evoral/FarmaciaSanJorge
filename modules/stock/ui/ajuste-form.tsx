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
 *
 * When preparaciones hold part of the saldo reserved (migration 0071,
 * openspec/specs/reserva-stock-preparacion/spec.md), the header shows the physical
 * saldo, the reserved part with its recetas and the free part -- the only one
 * an ajuste may consume (the server enforces it).
 *
 * Once saved it returns to the list the flow started from (`volverA`, posted
 * with the form; the action re-validates it against the allowlist of
 * modules/stock/domain/ajustes-listado.ts and answers the target).
 */
import { useRouter } from "next/navigation";
import { CoFirmaDt } from "@/shared/ui/co-firma-dt";
import { registrarAjusteAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { MOTIVOS_AJUSTE, MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { PARAM_VOLVER_AJUSTE, RETORNO_AJUSTE_DEFAULT, retornoAjusteRegistrado, type RetornoAjuste } from "@/modules/stock/domain/ajustes-listado";

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
  /** Part of the saldo reserved by preparaciones (already formatted), `null` when none. */
  reserva: { reservadoTexto: string; libreTexto: string; recetas: string[] } | null;
  /** `true` when the OPERATOR is themselves a vigente DT -- INV-U06: they still type their own password, and both `registradoPorId`/`autorizadoPorId` end up holding the same id. */
  operadorEsDt: boolean;
  /** The list to return to once saved (already allowlisted by the page). */
  volverA?: RetornoAjuste;
}


export function AjusteForm({
  partidaId,
  drogaNombre,
  lote,
  saldoPrincipal,
  saldoSecundario,
  unidades,
  unidadPorDefectoId,
  dts,
  reserva,
  operadorEsDt,
  volverA = RETORNO_AJUSTE_DEFAULT,
}: AjusteFormProps) {
  const router = useRouter();
  const unidadFija = unidades.length === 1 ? unidades[0]! : null;

  return (
    <div className="panel max-w-2xl">
      <div className="border-b border-zinc-100 p-4 sm:p-5">
        <p className="text-sm font-medium text-zinc-900">{drogaNombre}</p>
        <p className="text-xs text-zinc-500">
          Lote <span className="font-mono">{lote}</span> · {reserva ? "Saldo físico" : "Saldo disponible"}
        </p>
        <p className="mt-2 font-mono text-2xl font-semibold tracking-tight text-zinc-900 tabular-nums sm:text-3xl">
          {saldoPrincipal}
          {saldoSecundario ? <span className="block text-sm font-normal text-zinc-500 sm:ml-3 sm:inline sm:text-base">{saldoSecundario}</span> : null}
        </p>
        {reserva ? (
          <dl className="mt-3 grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-zinc-500">Reservado en preparación{reserva.recetas.length > 0 ? ` (receta ${reserva.recetas.map((n) => `Nº ${n}`).join(", ")})` : ""}</dt>
              <dd className="font-mono tabular-nums text-zinc-900">{reserva.reservadoTexto}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Libre para ajustar</dt>
              <dd className="font-mono font-semibold tabular-nums text-zinc-900">{reserva.libreTexto}</dd>
            </div>
          </dl>
        ) : null}
      </div>

      <div className="panel-body">
        <SimpleForm action={registrarAjusteAction} accion="stock.ajuste.registrar" submitLabel="Registrar ajuste" onSuccess={(state) => router.push(state.redirigirA ?? retornoAjusteRegistrado(volverA))}>
          <input type="hidden" name="partidaId" value={partidaId} />
          <input type="hidden" name={PARAM_VOLVER_AJUSTE} value={volverA} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="cantidad" className="field-label">
                Cantidad a descontar
              </label>
              <div className="flex min-w-0 items-center gap-2">
                <input id="cantidad" name="cantidad" type="text" inputMode="decimal" required className="input min-w-0 w-full flex-1 font-mono" />
                {unidadFija ? (
                  <>
                    <input type="hidden" name="unidadId" value={unidadFija.id} />
                    <span className="text-sm font-medium text-zinc-700">{unidadFija.simbolo}</span>
                  </>
                ) : (
                  <select id="unidadId" name="unidadId" required defaultValue={unidadPorDefectoId} aria-label="Unidad de la cantidad a descontar" className="input w-20 flex-none sm:w-24">
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
