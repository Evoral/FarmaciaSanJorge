/**
 * The "N° factura" filter of `/partidas`: what the user typed, read as a
 * supplier invoice number. `comprobante_compra` stores puntoVenta and numero
 * without leading zeros (migration 0062), so they are stripped here too.
 *
 * - "0001-00012345" / "A 0001-00012345" -> puntoVenta "1" + numero "12345".
 * - "12345" / "00012345" -> numero only.
 * - Nothing numeric -> `null` (the filter is ignored).
 */
export interface BusquedaFactura {
  puntoVenta?: string;
  numero: string;
}

function sinCerosIzquierda(digitos: string): string {
  return digitos.replace(/^0+(?=\d)/, "");
}

export function parseBusquedaFactura(texto: string): BusquedaFactura | null {
  const grupos = texto.match(/\d+/g);
  if (!grupos) return null;
  if (grupos.length === 1) return { numero: sinCerosIzquierda(grupos[0]) };
  return { puntoVenta: sinCerosIzquierda(grupos[0]), numero: sinCerosIzquierda(grupos[grupos.length - 1]) };
}
