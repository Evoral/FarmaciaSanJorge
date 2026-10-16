"use server";

/** Server Actions for `/stock/**` (FASE 5). */
import { revalidatePath } from "next/cache";
import { registrarAjusteStock } from "@/modules/stock/application/registrar-ajuste";
import { corregirCostoPartida } from "@/modules/stock/application/corregir-costo-partida";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { leerFacturaCompraPdf } from "@/modules/stock/application/leer-factura-compra-pdf";
import { importarFacturaCompra } from "@/modules/stock/application/importar-factura-compra";
import { registrarReanalisisPartida } from "@/modules/stock/application/reanalizar-partida";
import { marcarPartidaVencida } from "@/modules/stock/application/marcar-partida-vencida";
import type { MotivoAjuste } from "@/modules/stock/domain/partida";
import { PARAM_VOLVER_AJUSTE, retornoAjuste, retornoAjusteRegistrado } from "@/modules/stock/domain/ajustes-listado";
import { conOperador } from "@/shared/auth/operador-context";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { LeerFacturaPdfState, StockActionState } from "./action-state";

function fromError(error: unknown, fallback: string): StockActionState {
  return actionError(error, fallback);
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
  return conOperador(formData, async (): Promise<StockActionState> => {
    try {
      const { partidas } = await importarFacturaCompra(JSON.parse(String(formData.get("facturaJson") ?? "{}")));
      revalidatePath("/stock");
      return { status: "success", message: partidas === 1 ? "Factura registrada: 1 partida ingresada." : `Factura registrada: ${partidas} partidas ingresadas.` };
    } catch (error) {
      return fromError(error, "No se pudo importar la factura.");
    }
  });
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
  return conOperador(formData, async (): Promise<StockActionState> => {
    // Allowlisted (`retornoAjuste`): an unknown value falls back to /stock/ajustes, never an arbitrary redirect.
    const retorno = retornoAjuste(formData.get(PARAM_VOLVER_AJUSTE));
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
      revalidatePath("/cierres/ajustes");
      return { status: "success", message: "Ajuste registrado.", redirigirA: retornoAjusteRegistrado(retorno) };
    } catch (error) {
      return fromError(error, "No se pudo registrar el ajuste.");
    }
  });
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

/** Optional text field: empty = not given. */
function opcional(formData: FormData, campo: string): string | undefined {
  const valor = String(formData.get(campo) ?? "").trim();
  return valor ? valor : undefined;
}

function revalidarPartida(partidaId: string) {
  revalidatePath("/stock");
  revalidatePath(`/stock/partidas/${partidaId}`);
  revalidatePath("/cierres/vencimientos");
  revalidatePath("/");
}

/** "Registrar reanálisis" (docs/specs/reanalisis-partida.md): the use case verifies the DT's own password first. */
export async function registrarReanalisisAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  const partidaId = String(formData.get("partidaId") ?? "");
  try {
    await registrarReanalisisPartida({
      partidaId,
      fechaReanalisis: String(formData.get("fechaReanalisis") ?? ""),
      motivo: opcional(formData, "motivo"),
      respaldo: opcional(formData, "respaldo"),
      password: String(formData.get("password") ?? ""),
    });
    revalidarPartida(partidaId);
    return { status: "success", message: "Reanálisis registrado: la partida tiene un nuevo vencimiento vigente." };
  } catch (error) {
    return fromError(error, "No se pudo registrar el reanálisis.");
  }
}

/** "Marcar como vencida" (docs/specs/reanalisis-partida.md): discounts the whole saldo with a VENCIMIENTO ajuste. */
export async function marcarPartidaVencidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  const partidaId = String(formData.get("partidaId") ?? "");
  try {
    await marcarPartidaVencida({
      partidaId,
      observacion: opcional(formData, "observacion"),
      password: String(formData.get("password") ?? ""),
    });
    revalidarPartida(partidaId);
    revalidatePath("/stock/ajustes");
    revalidatePath("/cierres/ajustes");
    return { status: "success", message: "Partida marcada como vencida: se descontó todo su saldo." };
  } catch (error) {
    return fromError(error, "No se pudo marcar la partida como vencida.");
  }
}
