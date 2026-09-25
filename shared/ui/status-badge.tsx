/**
 * Colored pill for workflow states (receta, lote, usuario...). Maps the
 * raw SCREAMING_SNAKE_CASE estado to a tone and a readable label; unknown
 * estados fall back to the neutral tone so new states never break a page.
 */
type Tone = "success" | "warn" | "danger" | "neutral";

const TONE_BY_ESTADO: Record<string, Tone> = {
  PREPARADA: "success",
  LISTA_PARA_RETIRAR: "success",
  ENTREGADA: "neutral",
  ACTIVO: "success",
  VIGENTE: "success",
  CERRADO: "neutral",
  PENDIENTE_PREPARACION: "warn",
  EN_PREPARACION: "warn",
  ENVIADA_PEND_FIRMA: "warn",
  INICIADA: "warn",
  PENDIENTE: "warn",
  PENDIENTE_ACTIVACION: "warn",
  ANULADA: "danger",
  ANULADO: "danger",
  VENCIDA: "danger",
  SUSPENDIDO: "danger",
  BAJA: "danger",
};

const TONE_CLASSES: Record<Tone, string> = {
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
      {humanize(estado)}
    </span>
  );
}
