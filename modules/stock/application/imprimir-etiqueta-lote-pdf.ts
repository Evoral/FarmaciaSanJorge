/**
 * `imprimirEtiquetaLotePdf` (openspec/changes/lotes-elaborados; user decision 2026-11-02): the etiqueta of a lot
 * elaborated in the farmacia, the ONLY entry point `app/api/partidas/[id]/etiqueta/pdf/route.ts` uses. Printed right
 * after elaborating (the partida's screen opens its print dialog) and any time later from that screen. Nothing is
 * persisted: a reprint reads the lot as it is now (its vencimiento follows its drugs' reanálisis, EL5).
 *
 * The size and the cell of the sheet are resolved exactly as for a preparado's etiqueta (hoja-etiquetas R7, the same
 * `resolverColocacion`), and the PDF is drawn by the same engine (`renderEtiquetaLotePdf`).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { NotFoundError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { getHojaParaImprimir } from "@/modules/etiqueta-tamanos/application/get-hoja-para-imprimir";
import { renderEtiquetaLotePdf, resolverColocacion, type OpcionesEtiquetaPdf } from "@/modules/preparaciones/application/imprimir-etiqueta-pdf";
import { getLogoTenant } from "@/modules/farmacia/application/get-marca-tenant";
import { logoParaPdf } from "@/shared/pdf/logo";
import { armarContenidoEtiquetaLote } from "../domain/etiqueta-lote";
import { getDatosEtiquetaLote } from "../infrastructure/elaboracion-lote-repository";

export const getDatosEtiquetaLoteQuery = defineQuery({
  name: "stock.lote.etiqueta",
  permiso: "etiquetas.imprimir",
  input: z.object({ partidaId: uuid }),
  handler: async ({ tx, session, input }) => {
    const datos = await getDatosEtiquetaLote(tx, session.tenantId, input.partidaId);
    if (!datos) throw new NotFoundError("Lote elaborado no encontrado.");
    return datos;
  },
});

export async function imprimirEtiquetaLotePdf(partidaId: string, opciones: OpcionesEtiquetaPdf = {}): Promise<Buffer> {
  const hoja = await getHojaParaImprimir();
  const { tamano, celda } = await resolverColocacion(hoja, opciones);
  const datos = await getDatosEtiquetaLoteQuery.execute({ partidaId });
  const logo = logoParaPdf(await getLogoTenant());
  return renderEtiquetaLotePdf(armarContenidoEtiquetaLote(datos), tamano, hoja, celda, logo);
}
