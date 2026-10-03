/**
 * Shared presentation bits for `/libro/**`: the section tabs (recetario, contralor, históricos, integridad -- all under
 * the same `libro.ver` layout guard) and the tone of an asiento's visual estado. Server-safe.
 */
import { TabNav } from "@/shared/ui/tab-nav";
import type { BadgeTone } from "@/shared/ui/status-badge";

export type SeccionLibro = "recetario" | "contralor" | "historico" | "integridad";

const SECCIONES: readonly { key: SeccionLibro; label: string; href: string }[] = [
  { key: "recetario", label: "Libro recetario", href: "/libro" },
  { key: "contralor", label: "Libros contralor", href: "/libro/contralor" },
  { key: "historico", label: "Asientos históricos", href: "/libro/historico" },
  { key: "integridad", label: "Integridad", href: "/libro/integridad" },
];

export function LibroNav({ actual }: { actual: SeccionLibro }) {
  return <TabNav label="Secciones del libro" items={SECCIONES.map((s) => ({ key: s.key, label: s.label, href: s.href, active: s.key === actual }))} />;
}

/** VIGENTE reads as fine, ANULADO as removed, SIN_EFECTO (rectified) as needing attention. */
export function tonoEstadoAsiento(kind: "VIGENTE" | "ANULADO" | "SIN_EFECTO"): BadgeTone {
  return kind === "VIGENTE" ? "success" : kind === "ANULADO" ? "danger" : "warn";
}
