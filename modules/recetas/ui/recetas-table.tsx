"use client";

/**
 * Presentation of `/recetas`' current page of results. Purely visual: the
 * server already filtered, paginated and decided what each row allows
 * (`editable`, `anulable`); this component only renders it.
 *
 * - Desktop: table with row selection, client-side sort of THIS page
 *   (stated in the toolbar, never implied to be global), whole-row click
 *   to open, a quiet inline "Editar" and a "..." menu for the rest
 *   (destructive last).
 * - Phones: the same rows as a stacked record list.
 * - Selection drives a floating bar (copy the Nº of the selected recetas).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ArrowUpDown, Ban, Camera, Copy, Eye, FileText, Pencil, Stethoscope, Store, X, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";
import { etiquetaPago } from "../domain/pago";
import { ActionMenu, type ActionMenuItem } from "@/shared/ui/action-menu";
import { Avatar } from "@/shared/ui/avatar";
import { toast } from "@/shared/ui/toast";

export interface RecetaRow {
  id: string;
  numero: string;
  paciente: string;
  medico: string;
  origen: string;
  origenLabel: string;
  prescripcion: string;
  prescripcionKey: string;
  ingreso: string;
  ingresoKey: string;
  estado: string;
  /** Position of `estado` in the workflow, to sort by estado in flow order. */
  estadoOrden: number;
  /** Migration 0071: the receta was paid. */
  pagada: boolean;
  editable: boolean;
  anulable: boolean;
}

export interface RecetasTableProps {
  rows: readonly RecetaRow[];
  /** Total matches across all pages (server count). */
  total: number;
  /** Rendered instead of the table when `rows` is empty. */
  empty: ReactNode;
  /** Rendered under the rows (pagination). */
  footer?: ReactNode;
}

type SortKey = "numero" | "paciente" | "prescripcion" | "ingreso" | "estado";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const SORT_LABELS: Record<SortKey, string> = {
  numero: "Nº interno",
  paciente: "Paciente",
  prescripcion: "Prescripción",
  ingreso: "Ingreso",
  estado: "Estado",
};

const ORIGEN_ICONS: Record<string, LucideIcon> = {
  PRESENCIAL: Store,
  DIGITAL_PDF: FileText,
  DIGITAL_FOTO: Camera,
};

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

function compare(a: RecetaRow, b: RecetaRow, key: SortKey): number {
  switch (key) {
    case "numero":
      return collator.compare(a.numero, b.numero);
    case "paciente":
      return collator.compare(a.paciente, b.paciente);
    case "prescripcion":
      return a.prescripcionKey.localeCompare(b.prescripcionKey);
    case "ingreso":
      return a.ingresoKey.localeCompare(b.ingresoKey);
    case "estado":
      return a.estadoOrden - b.estadoOrden;
  }
}

const numberFormat = new Intl.NumberFormat("es-AR");

export function RecetasTable({ rows, total, empty, footer }: RecetasTableProps) {
  const router = useRouter();
  const [sort, setSort] = useState<Sort>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);

  // A new page of results (navigation) drops a selection that no longer applies.
  const rowsSignature = rows.map((row) => row.id).join(",");
  const [seenSignature, setSeenSignature] = useState(rowsSignature);
  if (rowsSignature !== seenSignature) {
    setSeenSignature(rowsSignature);
    setSelected(new Set());
    setSort(null);
  }

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => compare(a, b, sort.key) * factor);
  }, [rows, sort]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  const someSelected = selected.size > 0 && !allSelected;
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected;
  }, [someSelected]);

  if (rows.length === 0) return <div className="list-panel">{empty}</div>;

  function toggleSort(key: SortKey) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, dir: "asc" };
      if (current.dir === "asc") return { key, dir: "desc" };
      return null;
    });
  }

  function toggleRow(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((row) => row.id)));
  }

  async function copyNumbers(numeros: readonly string[]) {
    try {
      await navigator.clipboard.writeText(numeros.join(", "));
      toast(numeros.length === 1 ? `Se copió el Nº ${numeros[0]}.` : `Se copiaron ${numeros.length} números de receta.`);
    } catch {
      toast("No se pudo copiar al portapapeles.", "error");
    }
  }

  function openRow(event: MouseEvent<HTMLTableRowElement>, id: string) {
    // Controls inside the row keep their own behavior; text selection is not a click.
    if ((event.target as HTMLElement).closest("a, button, input, label")) return;
    if (window.getSelection()?.toString()) return;
    router.push(`/recetas/${id}`);
  }

  function menuItems(row: RecetaRow): ActionMenuItem[] {
    const items: ActionMenuItem[] = [
      { kind: "link", label: "Ver receta", href: `/recetas/${row.id}`, icon: Eye },
      ...(row.editable ? [{ kind: "link", label: "Editar", href: `/recetas/${row.id}/editar`, icon: Pencil } as const] : []),
      { kind: "action", label: "Copiar Nº", icon: Copy, onSelect: () => copyNumbers([row.numero]) },
    ];
    if (row.anulable) {
      items.push({ kind: "separator" }, { kind: "link", label: "Anular receta…", href: `/recetas/${row.id}`, icon: Ban, tone: "danger" });
    }
    return items;
  }

  const selectedNumbers = sorted.filter((row) => selected.has(row.id)).map((row) => row.numero);

  return (
    <div className="list-panel">
      <div className="list-toolbar">
        <p role="status">
          <span className="font-semibold text-zinc-900 tabular-nums">{numberFormat.format(total)}</span> {total === 1 ? "receta" : "recetas"}
        </p>
        {sort ? (
          <p className="flex items-center gap-2 text-xs">
            <span>
              Esta página, por <strong className="font-medium text-zinc-900">{SORT_LABELS[sort.key]}</strong> ({sort.dir === "asc" ? "ascendente" : "descendente"})
            </span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSort(null)}>
              Restablecer
            </button>
          </p>
        ) : null}
      </div>

      {/* Desktop / tablet: table. */}
      <div className="table-wrap hidden md:block">
        <table className="data-table">
          <caption className="sr-only">Recetas. Ordenar una columna reordena solo esta página.</caption>
          <thead>
            <tr>
              <th scope="col" className="check-cell px-3 py-2">
                <label>
                  <input ref={selectAllRef} type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Seleccionar todas las recetas de esta página" />
                </label>
              </th>
              <SortHeader label="Nº interno" sortKey="numero" sort={sort} onSort={toggleSort} />
              <SortHeader label="Ingreso" sortKey="ingreso" sort={sort} onSort={toggleSort} />
              <SortHeader label="Paciente" sortKey="paciente" sort={sort} onSort={toggleSort} />
              <SortHeader label="Prescripción" sortKey="prescripcion" sort={sort} onSort={toggleSort} />
              <SortHeader label="Estado" sortKey="estado" sort={sort} onSort={toggleSort} />
              <th scope="col" className="px-3 py-2">
                Pago
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">Acciones</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const isSelected = selected.has(row.id);
              const OrigenIcon = ORIGEN_ICONS[row.origen] ?? FileText;
              return (
                <tr key={row.id} className="is-clickable" data-selected={isSelected || undefined} onClick={(event) => openRow(event, row.id)}>
                  <td className="check-cell px-3 py-2.5">
                    <label>
                      <input type="checkbox" checked={isSelected} onChange={() => toggleRow(row.id)} aria-label={`Seleccionar receta Nº ${row.numero}`} />
                    </label>
                  </td>
                  <td className="px-3 py-2.5">
                    <Link href={`/recetas/${row.id}`} className="font-mono font-semibold underline-offset-2 hover:underline">
                      {row.numero}
                    </Link>
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-zinc-500" title={`Origen: ${row.origenLabel}`}>
                      <OrigenIcon className="size-3" aria-hidden />
                      {row.origenLabel}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{row.ingreso}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.paciente} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-zinc-900">{row.paciente}</p>
                        <p className="flex items-center gap-1 text-xs text-zinc-500">
                          <Stethoscope className="size-3 flex-none" aria-hidden />
                          <span className="sr-only">Médico:</span>
                          <span className="truncate">{row.medico}</span>
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{row.prescripcion}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge estado={row.estado} />
                  </td>
                  <td className="px-3 py-2.5">
                    <PagoBadge pagada={row.pagada} />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="row-actions flex items-center justify-end gap-1">
                      {row.editable ? (
                        <Link href={`/recetas/${row.id}/editar`} className="btn btn-ghost btn-sm" aria-label={`Editar receta Nº ${row.numero}`}>
                          <Pencil className="size-3.5" aria-hidden />
                          Editar
                        </Link>
                      ) : null}
                      <ActionMenu label={`Más acciones para la receta Nº ${row.numero}`} items={menuItems(row)} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Phones: stacked records. */}
      <ul className="md:hidden">
        {sorted.map((row) => (
          <li key={row.id} className="record">
            <div className="flex items-center justify-between gap-3">
              <Link href={`/recetas/${row.id}`} className="record-link font-mono text-sm font-semibold text-primary">
                Nº {row.numero}
              </Link>
              <span className="record-raised">
                <ActionMenu label={`Acciones para la receta Nº ${row.numero}`} items={menuItems(row)} />
              </span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">{row.paciente}</p>
                <p className="truncate text-xs text-zinc-500">{row.medico}</p>
              </div>
              <span className="flex flex-none flex-col items-end gap-1">
                <StatusBadge estado={row.estado} />
                <PagoBadge pagada={row.pagada} />
              </span>
            </div>
            <p className="text-xs text-zinc-500 tabular-nums">
              Ingreso {row.ingreso} · Prescripción {row.prescripcion} · {row.origenLabel}
            </p>
          </li>
        ))}
      </ul>

      {footer}

      {selected.size > 0 ? (
        <div className="selection-bar" role="region" aria-label="Acciones sobre la selección">
          <span className="pr-2 tabular-nums">
            <strong className="font-semibold">{selected.size}</strong> {selected.size === 1 ? "seleccionada" : "seleccionadas"}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyNumbers(selectedNumbers)}>
            <Copy className="size-3.5" aria-hidden />
            Copiar Nº
          </button>
          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setSelected(new Set())} aria-label="Quitar selección">
            <X className="size-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function PagoBadge({ pagada }: { pagada: boolean }) {
  return <ToneBadge tone={pagada ? "success" : "warn"}>{etiquetaPago(pagada)}</ToneBadge>;
}

interface SortHeaderProps {
  label: string;
  sortKey: SortKey;
  sort: Sort;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortHeader({ label, sortKey, sort, onSort, className }: SortHeaderProps) {
  const active = sort?.key === sortKey ? sort.dir : null;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <th scope="col" className={`px-3 py-2 ${className ?? ""}`} aria-sort={active ? (active === "asc" ? "ascending" : "descending") : undefined}>
      <button type="button" className="sort-button" onClick={() => onSort(sortKey)}>
        {label}
        <Icon aria-hidden />
      </button>
    </th>
  );
}
