"use server";

/** Server Actions for `/costos-proveedor` (docs/specs/costos-proveedor.md): manual entry, baja, the vigente lookup of the form, and the list import (read + confirm). */
import { revalidatePath } from "next/cache";
import { listarCostosVigentes } from "@/modules/costos-proveedor/application/listar-costos-vigentes";
import { registrarCostosProveedor } from "@/modules/costos-proveedor/application/registrar-costos-proveedor";
import { darDeBajaCostoProveedor } from "@/modules/costos-proveedor/application/dar-de-baja-costo-proveedor";
import { importarListaPrecios } from "@/modules/costos-proveedor/application/importar-lista-precios";
import { leerListaPrecios } from "@/modules/costos-proveedor/application/leer-lista-precios";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import type { CostoProveedorActionState, CostoVigenteDelParState, LeerListaState } from "./action-state";

function texto(formData: FormData, nombre: string): string {
  return String(formData.get(nombre) ?? "");
}

/** "40898,50" -> "40898.50": the form is typed in es-AR, the command takes a plain decimal. Anything else is left for the command to refuse. */
function normalizarDecimal(valor: string): string {
  const limpio = valor.trim();
  return /^\d+,\d+$/.test(limpio) ? limpio.replace(",", ".") : limpio;
}

/** The rows a form posted as `filas.<i>.<campo>` (the same names the command's errors point at). */
function filasDe(formData: FormData): Record<string, unknown>[] {
  const indices = new Set<number>();
  for (const clave of formData.keys()) {
    const coincidencia = /^filas\.(\d+)\./.exec(clave);
    if (coincidencia) indices.add(Number(coincidencia[1]));
  }
  return [...indices]
    .sort((a, b) => a - b)
    .map((i) => {
      const esperado = texto(formData, `filas.${i}.vigenteEsperadoId`);
      return {
        drogaId: texto(formData, `filas.${i}.drogaId`),
        precioInformado: normalizarDecimal(texto(formData, `filas.${i}.precioInformado`)),
        unidadPrecioId: texto(formData, `filas.${i}.unidadPrecioId`),
        fechaPrecio: texto(formData, `filas.${i}.fechaPrecio`),
        motivo: texto(formData, `filas.${i}.motivo`),
        // "" = the user saw no vigente costo for the pair (R23); the field is always posted.
        vigenteEsperadoId: esperado === "" ? null : esperado,
      };
    });
}

function revalidarCostos(): void {
  revalidatePath("/costos-proveedor");
  revalidatePath("/costos-proveedor/historial");
  revalidatePath("/costos-proveedor/listas");
}

export async function registrarCostoManualAction(_prevState: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
  try {
    const resultado = await registrarCostosProveedor({ proveedorId: texto(formData, "proveedorId"), filas: filasDe(formData) });
    revalidarCostos();
    if (resultado.sinCambios > 0 && resultado.ids.length === 0) {
      return { status: "success", message: "Sin cambios: ese precio ya estaba cargado con la misma fecha." };
    }
    return { status: "success", message: resultado.reemplazados > 0 ? "Precio actualizado." : "Costo cargado." };
  } catch (error) {
    return actionError(error, "No se pudo guardar el costo.");
  }
}

export async function darDeBajaCostoProveedorAction(_prevState: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
  try {
    await darDeBajaCostoProveedor({ costoProveedorId: texto(formData, "costoProveedorId"), motivo: texto(formData, "motivo") });
    revalidarCostos();
    return { status: "success", message: "Costo dado de baja." };
  } catch (error) {
    return actionError(error, "No se pudo dar de baja el costo.");
  }
}

/**
 * The vigente costo of one pair, for the manual form (it shows it and sends its id back as `vigenteEsperadoId`).
 * A thin wrapper over `listarCostosVigentes` filtered by BOTH ids (one vigente per pair, R1): same
 * `stock.valorizado.ver` permiso, read only.
 */
export async function obtenerCostoVigenteDelParAction(drogaId: string, proveedorId: string): Promise<CostoVigenteDelParState> {
  try {
    const { items } = await listarCostosVigentes({ drogaId: String(drogaId ?? ""), proveedorId: String(proveedorId ?? ""), page: 1, pageSize: 1 });
    const costo = items[0];
    if (!costo) return { status: "ok", costo: null };
    return {
      status: "ok",
      costo: {
        id: costo.id,
        precioInformado: costo.precioInformado,
        unidadPrecioId: costo.unidadPrecioId,
        unidadPrecioSimbolo: costo.unidadPrecioSimbolo,
        costoUnitario: costo.costoUnitario,
        fechaPrecio: costo.fechaPrecio,
        listaNombreArchivo: costo.listaNombreArchivo,
      },
    };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudo consultar el costo vigente.") };
  }
}

/** Reads a supplier price list into the import preview (R13) -- writes nothing; the file is read in memory and discarded. */
export async function leerListaPreciosAction(_prevState: LeerListaState, formData: FormData): Promise<LeerListaState> {
  try {
    const vista = await leerListaPrecios({
      proveedorId: texto(formData, "proveedorId"),
      fechaLista: texto(formData, "fechaLista"),
      archivo: formData.get("archivo"),
      hoja: texto(formData, "hoja") || undefined,
    });
    return { status: "success", vista };
  } catch (error) {
    return actionError(error, "No se pudo leer la lista.");
  }
}

/** Confirms the import (R20): the kept rows travel as ONE JSON field, so an error never loses what was edited. */
export async function importarListaPreciosAction(_prevState: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
  try {
    const resultado = await importarListaPrecios(JSON.parse(String(formData.get("listaJson") ?? "{}")));
    revalidarCostos();
    const actualizados = resultado.insertados + resultado.reemplazados;
    return { status: "success", message: actualizados === 1 ? "Lista importada: 1 costo actualizado." : `Lista importada: ${actualizados} costos actualizados.` };
  } catch (error) {
    return actionError(error, "No se pudo importar la lista.");
  }
}
