"use client";

/**
 * List filter over a SHORT, already-loaded set of options (usuarios, roles, entidades...) as an autocomplete: typing
 * narrows the options and picking one sets `param` in the list's URL (clearing the box removes it). The page renders
 * the options on the server and passes the list URL with its other filters; `page` and any extra `resetParams`
 * (e.g. a cursor) are dropped on every change.
 */
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Combobox, filtrarOpciones } from "./combobox";
import type { ComboboxOption } from "./combobox";
import { hrefConParam } from "./href-con-param";

export interface FiltroOpcionesProps {
  id: string;
  label: string;
  placeholder: string;
  opciones: readonly ComboboxOption[];
  /** The URL param this filter sets. */
  param: string;
  /** The list's URL with its current filters. */
  href: string;
  /** The value currently filtered, if any. */
  valor?: string;
  /** Show the label above the box (filter drawers) instead of only to screen readers (filter bars). */
  visibleLabel?: boolean;
  /** Other params to drop on change (e.g. "cursor"). */
  resetParams?: readonly string[];
}

export function FiltroOpciones({ id, label, placeholder, opciones, param, href, valor, visibleLabel = false, resetParams = [] }: FiltroOpcionesProps) {
  const router = useRouter();
  const search = useMemo(() => filtrarOpciones(opciones, 50), [opciones]);
  const seleccion = valor ? (opciones.find((o) => o.value === valor) ?? null) : null;

  return (
    <Combobox
      id={id}
      label={label}
      hideLabel={!visibleLabel}
      placeholder={placeholder}
      search={search}
      value={seleccion}
      onChange={(option) => {
        let destino = hrefConParam(href, param, option?.value ?? "");
        for (const extra of resetParams) destino = hrefConParam(destino, extra, "");
        router.push(destino, { scroll: false });
      }}
    />
  );
}
