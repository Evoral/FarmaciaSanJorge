/**
 * The fórmula de la prescripción of one ítem as the libro recetario records it (openspec/specs/libro-recetario-y-contralor/spec.md,
 * "Fórmula de la prescripción"): as it came in the receta -- EVERY componente (controlled or not, excipientes
 * included) with its prescribed quantity, then the excipiente actually used (typed in the toma workspace, migration
 * 0083) as "c.s.p.", then the quantity and forma ("60 Cápsulas (1 cápsula = ½ dosis)", "Crema c.s.p. 100 g").
 * Pure, no I/O.
 *
 * "Minoxidil 5 mg; Finasteride 1 mg; Ludipress c.s.p. — 60 Cápsulas (1 cápsula = ½ dosis)"
 */
import { dec } from "@/shared/decimal";
import { formatNumero } from "@/shared/format/cantidad";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { ordenarComponentes } from "@/modules/elaboracion/domain/orden-componentes";
import type { ModoExpresion } from "@/modules/recetas/domain/receta";
import { FORMAS_POR_UNIDAD, formaSegunCantidad } from "./etiqueta";

/** Excipiente field limit (`preparacion.excipiente_texto varchar(120)`). */
export const EXCIPIENTE_MAX = 120;

const FRACCIONES: ReadonlyArray<{ valor: number; texto: string }> = [
  { valor: 0.5, texto: "½" },
  { valor: 1 / 3, texto: "⅓" },
  { valor: 0.25, texto: "¼" },
];

export interface ComponentePrescripto {
  drogaNombre: string;
  /** Decimal string as prescribed; `null` for CS/CSP. */
  cantidad: string | null;
  unidadSimbolo: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
}

export interface ItemPrescripto {
  formaFarmaceutica: string;
  cantidadUnidades: number;
  /** Decimal string in (0, 1]: how much of a dose one unit holds. */
  fraccionDosisPorUnidad: string;
  /** Non-capsular forms: the c.s.p. total and its unit, when prescribed. */
  cantidadTotal: string | null;
  unidadTotalSimbolo: string | null;
  componentes: readonly ComponentePrescripto[];
  /** The excipiente actually used (toma workspace), `null` when not informed. */
  excipiente: string | null;
}

function lineaComponente(c: ComponentePrescripto): string {
  if (c.cantidad === null) return `${c.drogaNombre} ${c.modoExpresion === "CS" ? "c.s." : "c.s.p."}`;
  return `${c.drogaNombre} ${formatNumero(c.cantidad)} ${c.unidadSimbolo}`;
}

function textoFraccion(valor: string): string {
  const numero = dec(valor);
  return FRACCIONES.find((f) => numero.minus(f.valor).abs().lessThan(0.001))?.texto ?? formatNumero(valor);
}

function cantidadYForma(item: ItemPrescripto): string {
  const forma = item.formaFarmaceutica;
  if (FORMAS_POR_UNIDAD.has(forma) || !item.cantidadTotal) {
    const base = `${item.cantidadUnidades} ${formaSegunCantidad(forma, item.cantidadUnidades)}`;
    if (!FORMAS_POR_UNIDAD.has(forma) || dec(item.fraccionDosisPorUnidad).equals(1)) return base;
    const unidad = formaSegunCantidad(forma, 1).toLocaleLowerCase("es-AR");
    return `${base} (1 ${unidad} = ${textoFraccion(item.fraccionDosisPorUnidad)} dosis)`;
  }
  const label = FORMA_FARMACEUTICA_LABELS[forma as keyof typeof FORMA_FARMACEUTICA_LABELS] ?? forma;
  return `${label} c.s.p. ${formatNumero(item.cantidadTotal)}${item.unidadTotalSimbolo ? ` ${item.unidadTotalSimbolo}` : ""}`;
}

/** The trimmed excipiente, or `null` when blank. */
export function normalizarExcipiente(valor: string | null | undefined): string | null {
  const limpio = (valor ?? "").trim().replace(/\s+/g, " ");
  return limpio === "" ? null : limpio;
}

export function formatearFormulaPrescripcion(item: ItemPrescripto): string {
  const lineas = ordenarComponentes(item.componentes).map(lineaComponente);
  const excipiente = normalizarExcipiente(item.excipiente);
  if (excipiente) lineas.push(`${excipiente} c.s.p.`);
  return `${lineas.join("; ")} — ${cantidadYForma(item)}`;
}
