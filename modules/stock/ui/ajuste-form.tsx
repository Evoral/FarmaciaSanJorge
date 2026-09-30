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
    <SimpleForm action={registrarAjusteAction} submitLabel="Registrar ajuste" className="max-w-lg" onSuccess={() => router.push(REGISTRADO_HREF)}>
      <input type="hidden" name="partidaId" value={partidaId} />

      <div className="card p-4 text-sm">
        <p className="font-medium">{drogaNombre}</p>
        <p className="text-zinc-600 dark:text-zinc-400">Lote {lote} · Saldo disponible</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">
          {saldoPrincipal}
          {saldoSecundario ? <span className="ml-2 text-base font-normal text-zinc-600 dark:text-zinc-400">· {saldoSecundario}</span> : null}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cantidad" className="text-sm font-medium">
          Cantidad a descontar
        </label>
        <div className="flex items-center gap-2">
          <input id="cantidad" name="cantidad" type="text" inputMode="decimal" required className="input min-w-0 flex-1" />
          {unidadFija ? (
            <>
              <input type="hidden" name="unidadId" value={unidadFija.id} />
              <span className="text-sm font-medium">{unidadFija.simbolo}</span>
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

      <div className="flex flex-col gap-1">
        <label htmlFor="motivoAjuste" className="text-sm font-medium">
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

      <div className="flex flex-col gap-1">
        <label htmlFor="observacion" className="text-sm font-medium">
          Observación
        </label>
        <textarea id="observacion" name="observacion" required rows={2} className="input" />
      </div>

      <fieldset className="card p-4">
        <legend className="px-1 text-sm font-medium">Co-firma del Director Técnico</legend>
        {operadorEsDt ? (
          <p className="mb-2 text-xs text-zinc-500">
            Sos DT vigente: aun así, ingresá tu propia contraseña para autorizar este ajuste.
          </p>
        ) : null}
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
    </SimpleForm>
  );
}
