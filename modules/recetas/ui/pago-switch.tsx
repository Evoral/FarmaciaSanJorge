"use client";

/** The receta's "Pagada" switch (docs/specs/pago-receta.md), one look wherever the payment is set. */
import { formatNumero } from "@/shared/format/cantidad";

function precio(valor: string): string {
  return `$${formatNumero(valor, 2)}`;
}

export interface PagoPanel {
  pagada: boolean;
  onChange: (pagada: boolean) => void;
  disabled: boolean;
  /** Form field name (`crear` reads it from the form; `importar` sends it inside `importacionJson`). */
  name?: string;
}

/**
 * "Pagada" switch: the whole receta is paid, so ítems added later are covered by the same payment. Also used by the
 * receta detail (./pago-receta-form.tsx), where it saves on toggle, and by the entrega form
 * (modules/entregas/ui/registrar-entrega-form.tsx) -- neither shows the total.
 */
export function PagoSwitch({ pago, total = null, className = "mt-4" }: { pago: PagoPanel; total?: string | null; className?: string }) {
  return (
    <div
      className={`${className} flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors ${pago.pagada ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-zinc-50"}`}
    >
      <label className="toggle-switch min-h-0 flex-1 font-medium text-zinc-900">
        <input type="checkbox" role="switch" name={pago.name} checked={pago.pagada} disabled={pago.disabled} onChange={(e) => pago.onChange(e.target.checked)} />
        {pago.pagada ? "Pagada" : "Marcar como pagada"}
      </label>
      {pago.pagada && total !== null ? <span className="text-sm font-semibold tabular-nums text-emerald-800">{precio(total)}</span> : null}
    </div>
  );
}
