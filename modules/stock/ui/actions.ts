"use server";

/** Server Actions for `/stock/**` (FASE 5). */
import { revalidatePath } from "next/cache";
import { ingresarPartida } from "@/modules/stock/application/ingresar-partida";
import { registrarAjusteStock } from "@/modules/stock/application/registrar-ajuste";
import { corregirCostoPartida } from "@/modules/stock/application/corregir-costo-partida";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { leerFacturaCompraPdf } from "@/modules/stock/application/leer-factura-compra-pdf";
import { importarFacturaCompra } from "@/modules/stock/application/importar-factura-compra";
import type { MotivoAjuste } from "@/modules/stock/domain/partida";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { LeerFacturaPdfState, StockActionState } from "./action-state";

function fromError(error: unknown, fallback: string): StockActionState {
  return actionError(error, fallback);
}

export async function ingresarPartidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await ingresarPartida({
      drogaId: String(formData.get("drogaId") ?? ""),
      proveedorId: String(formData.get("proveedorId") ?? ""),
      lote: String(formData.get("lote") ?? ""),
      fechaVencimiento: String(formData.get("fechaVencimiento") ?? ""),
      cantidadCompra: String(formData.get("cantidadCompra") ?? ""),
      unidadCompraId: String(formData.get("unidadCompraId") ?? ""),
      costoUnitario: String(formData.get("costoUnitario") ?? ""),
      numeroValeAdquisicion: (formData.get("numeroValeAdquisicion") as string | null)?.trim() || undefined,
      potenciaDeclarada: (formData.get("potenciaDeclarada") as string | null)?.trim() || undefined,
    });
    revalidatePath("/stock");
    return { status: "success", message: "Partida ingresada." };
  } catch (error) {
    return fromError(error, "No se pudo ingresar la partida.");
  }
}

/** Reads a supplier invoice PDF into the import preview -- writes nothing (the file is read in memory and discarded). */
export async function leerFacturaCompraPdfAction(_prevState: LeerFacturaPdfState, formData: FormData): Promise<LeerFacturaPdfState> {
  try {
    const vistaPrevia = await leerFacturaCompraPdf(formData.get("archivo"));
    return { status: "success", vistaPrevia };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo leer la factura.") };
  }
}

export async function importarFacturaCompraAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    const { partidas } = await importarFacturaCompra(JSON.parse(String(formData.get("facturaJson") ?? "{}")));
    revalidatePath("/stock");
    return { status: "success", message: partidas === 1 ? "Factura importada: 1 partida ingresada." : `Factura importada: ${partidas} partidas ingresadas.` };
  } catch (error) {
    return fromError(error, "No se pudo importar la factura.");
  }
}

export type CrearProductoFacturaState = { status: "success"; id: string } | { status: "error"; message: string; fields?: string[] };

/**
 * "Crear «texto de la factura»" from the invoice import: alta of a droga or
 * insumo (migration 0063) without leaving the form. Called directly (not a
 * form submit -- it lives inside the import form). `drogas.crear` is
 * checked by the command itself; the form only offers it when allowed.
 */
export async function crearProductoDesdeFacturaAction(input: { nombre: string; unidadBaseId: string; clase: string }): Promise<CrearProductoFacturaState> {
  try {
    const { id } = await crearDroga({ nombre: input.nombre, unidadBaseId: input.unidadBaseId, clase: input.clase, stockMinimo: "0" });
    revalidatePath("/catalogos/drogas");
    return { status: "success", id };
  } catch (error) {
    return actionError(error, "No se pudo crear el producto.");
  }
}

/**
 * FIX 4 (jd-fix-agent, 2026-09-23): `registrarAjusteStock` itself now runs
 * the DT co-firma verification (own transaction, rate-limited, audits
 * failures) BEFORE doing anything else -- this Server Action only forwards
 * the raw form fields, it does NOT verify anything itself. See
 * `modules/stock/application/registrar-ajuste.ts`'s module doc comment for
 * why this moved out of the UI layer (an exported command that trusted a
 * pre-verified id could be called directly by ANY other caller, bypassing
 * co-firma entirely).
 */
export async function registrarAjusteAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await registrarAjusteStock({
      partidaId: String(formData.get("partidaId") ?? ""),
      cantidad: String(formData.get("cantidad") ?? ""),
      unidadId: (formData.get("unidadId") as string | null) || undefined,
      motivoAjuste: String(formData.get("motivoAjuste") ?? "") as MotivoAjuste,
      observacion: String(formData.get("observacion") ?? ""),
      dtUsuarioId: String(formData.get("dtUsuarioId") ?? ""),
      dtPassword: String(formData.get("dtPassword") ?? ""),
    });
    revalidatePath("/stock");
    revalidatePath("/stock/ajustes");
    return { status: "success", message: "Ajuste registrado." };
  } catch (error) {
    return fromError(error, "No se pudo registrar el ajuste.");
  }
}

export async function corregirCostoPartidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    await corregirCostoPartida({
      id: String(formData.get("id") ?? ""),
      costoUnitarioNuevo: String(formData.get("costoUnitarioNuevo") ?? ""),
      motivo: String(formData.get("motivo") ?? ""),
    });
    revalidatePath("/stock");
    return { status: "success", message: "Costo corregido." };
  } catch (error) {
    return fromError(error, "No se pudo corregir el costo.");
  }
}
