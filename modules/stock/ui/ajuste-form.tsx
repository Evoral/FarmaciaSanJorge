"use client";

/**
 * `/stock/ajustes/nuevo` form (FASE 5 point 5.4, DP-08b RESUELTA). The DT
 * co-signature is built into this SAME form (co-firma en el mismo acto):
 * the operator fills in the ajuste, and the DT types THEIR OWN password
 * right below, in the same submit -- `registrarAjusteAction`
 * (modules/stock/ui/actions.ts) verifies it server-side before writing
 * anything.
 */
import { registrarAjusteAction } from "./actions";
import { SimpleForm } from "./simple-form";
import { MOTIVOS_AJUSTE, MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";

export interface DtOpcion {
  id: string;
  label: string;
}

export interface AjusteFormProps {
  partidaId: string;
  drogaNombre: string;
  lote: string;
  cantidadDisponible: string;
  dts: DtOpcion[];
  /** `true` when the OPERATOR is themselves a vigente DT -- INV-U06: they still type their own password, and both `registradoPorId`/`autorizadoPorId` end up holding the same id. */
  operadorEsDt: boolean;
}

export function AjusteForm({ partidaId, drogaNombre, lote, cantidadDisponible, dts, operadorEsDt }: AjusteFormProps) {
  return (
    <SimpleForm action={registrarAjusteAction} submitLabel="Registrar ajuste" className="flex max-w-lg flex-col gap-4">
      <input type="hidden" name="partidaId" value={partidaId} />

      <div className="card p-4 text-sm">
        <p className="font-medium">{drogaNombre}</p>
        <p className="text-zinc-600 dark:text-zinc-400">
          Lote {lote} · Saldo disponible: {cantidadDisponible}
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="cantidad" className="text-sm font-medium">
          Cantidad a descontar
        </label>
        <input id="cantidad" name="cantidad" type="text" inputMode="decimal" required className="input" />
        <p className="text-xs text-zinc-500">Todo ajuste descuenta del saldo (DP-21b) -- no existen ajustes positivos.</p>
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
