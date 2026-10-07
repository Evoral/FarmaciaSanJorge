"use client";

/**
 * Picks the time window of `/recetas`' per-estado summary (`?periodo=`).
 * Only the counts change, so every other param (filters, page) is kept;
 * the default window is left out of the URL.
 */
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { PERIODOS_RESUMEN, PERIODO_RESUMEN_DEFAULT, PERIODO_RESUMEN_LABELS, type PeriodoResumen } from "../domain/periodo-resumen";

export function PeriodoResumenSelect({ value }: { value: PeriodoResumen }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function onChange(next: string) {
    const qs = new URLSearchParams(searchParams.toString());
    // One-shot "receta registrada" notice params, dropped like any other navigation from the list does.
    qs.delete("registrada");
    qs.delete("aviso");
    if (next === PERIODO_RESUMEN_DEFAULT) qs.delete("periodo");
    else qs.set("periodo", next);
    const query = qs.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="periodo" className="text-xs text-zinc-500">
        Período
      </label>
      <select id="periodo" value={value} onChange={(event) => onChange(event.target.value)} className="input py-1 text-xs" aria-busy={pending || undefined}>
        {PERIODOS_RESUMEN.map((periodo) => (
          <option key={periodo} value={periodo}>
            {PERIODO_RESUMEN_LABELS[periodo]}
          </option>
        ))}
      </select>
    </div>
  );
}
