/**
 * Modo del lector of the "Importar con QR" panel (openspec/changes/lector-qr-configurable): CAMARA shows the
 * "Escanear con la cámara" button, LECTOR (a USB scanner that types the code and presses Enter) hides it. Both keep
 * the same input, so the mode only decides what the panel SHOWS: reading a receta never depends on it.
 *
 * Two levels: the farmacia's `lector_qr_receta` parametro and an optional per-equipo choice stored in the browser.
 * The equipo wins when it picked a mode; "FARMACIA" (or nothing) follows the farmacia; CAMARA is the last fallback.
 * Unknown stored values, on either level, are ignored.
 */

export const MODOS_LECTOR_QR = ["CAMARA", "LECTOR"] as const;

export type ModoLectorQr = (typeof MODOS_LECTOR_QR)[number];

export const MODO_LECTOR_QR_POR_DEFECTO: ModoLectorQr = "CAMARA";

export const ETIQUETA_MODO_LECTOR_QR: Record<ModoLectorQr, string> = {
  CAMARA: "Cámara",
  LECTOR: "Lector USB",
};

/** The equipo's choice: one of the modes, or follow the farmacia. */
export type EleccionEquipoLectorQr = ModoLectorQr | "FARMACIA";

export const ELECCION_EQUIPO_SEGUN_FARMACIA = "FARMACIA" as const;

/** Exact match only: a stored value is ours, never typed by a person. */
export function parseModoLectorQr(valor: string | null | undefined): ModoLectorQr | null {
  return MODOS_LECTOR_QR.find((modo) => modo === valor) ?? null;
}

export function resolverModoLectorQr({ farmacia, equipo }: { farmacia: string | null | undefined; equipo: string | null | undefined }): ModoLectorQr {
  return parseModoLectorQr(equipo) ?? parseModoLectorQr(farmacia) ?? MODO_LECTOR_QR_POR_DEFECTO;
}
