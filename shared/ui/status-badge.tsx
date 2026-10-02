/**
 * Colored pill for workflow states (receta, lote, usuario...). Maps the
 * raw SCREAMING_SNAKE_CASE estado to a tone and a readable label; unknown
 * estados fall back to the neutral tone so new states never break a page.
 */
import type { ReactNode } from "react";
import { ESTADO_PREPARACION_LABELS, ESTADO_RECETA_LABELS, ESTADO_USUARIO_LABELS } from "@/shared/labels/enum-labels";

export type BadgeTone = "success" | "warn" | "danger" | "neutral";

/** Estados with a proper Spanish label (shared/labels/enum-labels.ts); anything else is humanized. */
const LABEL_BY_ESTADO: Readonly<Record<string, string>> = {
  ...ESTADO_USUARIO_LABELS,
  ...ESTADO_PREPARACION_LABELS,
  ...ESTADO_RECETA_LABELS,
};

const TONE_BY_ESTADO: Record<string, BadgeTone> = {
  PREPARADA: "success",
  CONFIRMADA: "success",
  LISTA_PARA_RETIRAR: "success",
  ENTREGADA: "neutral",
  DESCARTADA: "neutral",
  ACTIVO: "success",
  VIGENTE: "success",
  CERRADO: "neutral",
  PENDIENTE_PREPARACION: "warn",
  EN_PREPARACION: "warn",
  ENVIADA_PEND_FIRMA: "warn",
  INICIADA: "warn",
  PENDIENTE: "warn",
  PENDIENTE_ACTIVACION: "warn",
  SIN_EFECTO: "warn",
  ANULADA: "danger",
  ANULADO: "danger",
  VENCIDA: "danger",
  POR_VENCER: "warn",
  AGOTADA: "neutral",
  ABIERTA: "neutral",
  SUSPENDIDO: "danger",
  BAJA: "danger",
};

const TONE_CLASSES: Record<BadgeTone, string> = {
  success: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
  neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function humanize(estado: string): string {
  const text = estado.replaceAll("_", " ").toLowerCase().replace(/\bpend\b/, "pend.");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function StatusBadge({ estado }: { estado: string }) {
  const tone = TONE_BY_ESTADO[estado] ?? "neutral";
  return (
    <span className={`badge ${TONE_CLASSES[tone]}`} title={estado}>
      {Object.hasOwn(LABEL_BY_ESTADO, estado) ? LABEL_BY_ESTADO[estado] : humanize(estado)}
    </span>
  );
}

/**
 * The same pill as `StatusBadge` for a flag that is not a workflow estado
 * ("Más barato", "Revisar"...): the caller picks the tone and the text.
 */
export function ToneBadge({ tone, title, children }: { tone: BadgeTone; title?: string; children: ReactNode }) {
  return (
    <span className={`badge ${TONE_CLASSES[tone]}`} title={title}>
      {children}
    </span>
  );
}
