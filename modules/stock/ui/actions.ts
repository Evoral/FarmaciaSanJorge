"use server";

/** Server Actions for `/stock/**` (FASE 5). */
import { revalidatePath } from "next/cache";
import { registrarAjusteStock } from "@/modules/stock/application/registrar-ajuste";
import { corregirCostoPartida } from "@/modules/stock/application/corregir-costo-partida";
import { corregirPotenciaPartida } from "@/modules/stock/application/corregir-potencia-partida";
import { crearDroga } from "@/modules/drogas/application/crear-droga";
import { leerFacturaCompraPdf } from "@/modules/stock/application/leer-factura-compra-pdf";
import { importarFacturaCompra } from "@/modules/stock/application/importar-factura-compra";
import { registrarReanalisisPartida } from "@/modules/stock/application/reanalizar-partida";
import { marcarPartidaVencida } from "@/modules/stock/application/marcar-partida-vencida";
import { cerrarRelevamientoInicial } from "@/modules/stock/application/cerrar-relevamiento-inicial";
import {
  guardarFilaRelevamiento,
  type GuardarFilaRelevamientoInput,
} from "@/modules/stock/application/guardar-fila-relevamiento";
import { quitarFilaRelevamiento } from "@/modules/stock/application/quitar-fila-relevamiento";
import { getPlanillaRelevamiento } from "@/modules/stock/application/get-planilla-relevamiento";
import { pasarGrupoAStock } from "@/modules/stock/application/pasar-grupo-a-stock";
import { corregirCantidadInicial } from "@/modules/stock/application/corregir-cantidad-inicial";
import { corregirDatosPartidaInicial } from "@/modules/stock/application/corregir-datos-partida-inicial";
import { claveGrupo } from "@/modules/stock/domain/existencia-inicial";
import { elaborarLote } from "@/modules/stock/application/elaborar-lote";
import { datosParaElaborar, type DatosParaElaborar } from "@/modules/stock/application/datos-para-elaborar";
import { getHojaParaImprimir } from "@/modules/etiqueta-tamanos/application/get-hoja-para-imprimir";
import { listTamanosParaImprimir } from "@/modules/etiqueta-tamanos/application/list-tamanos-para-imprimir";
import type { HojaEtiqueta } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import type { EtiquetaTamano } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import type { MotivoAjuste } from "@/modules/stock/domain/partida";
import { PARAM_VOLVER_AJUSTE, retornoAjuste, retornoAjusteRegistrado } from "@/modules/stock/domain/ajustes-listado";
import { conOperador } from "@/shared/auth/operador-context";
import { OperadorRequeridoError } from "@/shared/errors";
import { actionError, actionErrorMessage } from "@/shared/ui/action-error";
import { importarPlanillaExcel } from "@/modules/stock/application/importar-planilla-excel";
import type { ImportarPlanillaExcelState, LeerFacturaPdfState, StockActionState } from "./action-state";

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
      revalidatePath("/partidas");
      return { status: "success", message: partidas === 1 ? "Factura registrada: 1 partida ingresada." : `Factura registrada: ${partidas} partidas ingresadas.` };
    } catch (error) {
      return fromError(error, "No se pudo importar la factura.");
    }
  });
}

export type CrearProductoFacturaState =
  | { status: "success"; id: string }
  | { status: "error"; message: string; fields?: string[] }
  | { status: "operador-required" };

/**
 * "Crear «texto de la factura»" from the invoice import: alta of a droga or
 * insumo (migration 0063) without leaving the form. Called directly (not a
 * form submit -- it lives inside the import form). `drogas.crear` is
 * checked by the command itself; the form only offers it when allowed.
 * `drogas.crear` can require the operador's PIN on a cuenta de sector, so the
 * fields travel as `FormData` through `conOperador`.
 */
export async function crearProductoDesdeFacturaAction(formData: FormData): Promise<CrearProductoFacturaState> {
  return conOperador(formData, async (): Promise<CrearProductoFacturaState> => {
    try {
      const { id } = await crearDroga({
        nombre: String(formData.get("nombre") ?? ""),
        unidadBaseId: String(formData.get("unidadBaseId") ?? ""),
        clase: String(formData.get("clase") ?? ""),
        stockMinimo: "0",
      });
      revalidatePath("/catalogos/drogas");
      return { status: "success", id };
    } catch (error) {
      return actionError(error, "No se pudo crear el producto.");
    }
  });
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
      unidadId: String(formData.get("unidadId") ?? "") || undefined,
      motivo: String(formData.get("motivo") ?? ""),
    });
    revalidatePath("/stock");
    return { status: "success", message: "Costo corregido." };
  } catch (error) {
    return fromError(error, "No se pudo corregir el costo.");
  }
}

export async function corregirPotenciaPartidaAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  const id = String(formData.get("id") ?? "");
  try {
    await corregirPotenciaPartida({
      id,
      potenciaDeclaradaNueva: opcional(formData, "potenciaDeclaradaNueva"),
      motivo: String(formData.get("motivo") ?? ""),
    });
    revalidatePath("/stock");
    revalidatePath(`/partidas/${id}`);
    return { status: "success", message: "Pureza corregida." };
  } catch (error) {
    return fromError(error, "No se pudo corregir la pureza.");
  }
}

/** Optional text field: empty = not given. */
function opcional(formData: FormData, campo: string): string | undefined {
  const valor = String(formData.get(campo) ?? "").trim();
  return valor ? valor : undefined;
}

function revalidarPartida(partidaId: string) {
  revalidatePath("/stock");
  revalidatePath(`/partidas/${partidaId}`);
  revalidatePath("/cierres/vencimientos");
  revalidatePath("/");
}

/** "Registrar reanálisis" (openspec/specs/reanalisis-partida/spec.md): the use case verifies the DT's own password first. */
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

/** "Marcar como vencida" (openspec/specs/reanalisis-partida/spec.md): discounts the whole saldo with a VENCIMIENTO ajuste. */
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
    return { status: "success", message: "Partida marcada como vencida: se descontó todo su saldo." };
  } catch (error) {
    return fromError(error, "No se pudo marcar la partida como vencida.");
  }
}

/** "Cerrar relevamiento" (R7): the use case verifies the DT's own password first. */
export async function cerrarRelevamientoInicialAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  try {
    const descartarFilasRaw = formData.get("descartarFilas");
    const descartarFilas =
      descartarFilasRaw === "true" || descartarFilasRaw === "1" || descartarFilasRaw === "on";
    await cerrarRelevamientoInicial({
      password: String(formData.get("password") ?? ""),
      descartarFilas,
    });
    revalidatePath("/partidas/existencia-inicial");
    revalidatePath("/partidas");
    return { status: "success", message: "Relevamiento inicial cerrado: desde ahora el stock entra solo por compras." };
  } catch (error) {
    return fromError(error, "No se pudo cerrar el relevamiento inicial.");
  }
}

/** Guarda o actualiza una fila borrador de la planilla de relevamiento (permiso `stock.relevamiento.editar`). */
export async function guardarFilaRelevamientoAction(
  arg1: StockActionState | GuardarFilaRelevamientoInput,
  arg2?: FormData,
): Promise<StockActionState> {
  try {
    let input: GuardarFilaRelevamientoInput;
    if (arg2 instanceof FormData) {
      input = {
        id: String(arg2.get("id") ?? ""),
        drogaId: opcional(arg2, "drogaId"),
        lote: opcional(arg2, "lote"),
        fechaVencimiento: opcional(arg2, "fechaVencimiento"),
        cantidad: opcional(arg2, "cantidad"),
        unidadMedidaId: opcional(arg2, "unidadMedidaId"),
        potenciaDeclarada: opcional(arg2, "potenciaDeclarada"),
        costoUnitario: opcional(arg2, "costoUnitario"),
        proveedorId: opcional(arg2, "proveedorId"),
        textoDroga: opcional(arg2, "textoDroga"),
      };
    } else {
      input = arg1 as GuardarFilaRelevamientoInput;
    }
    await guardarFilaRelevamiento(input);
    revalidatePath("/partidas/existencia-inicial");
    return { status: "success", message: "Fila guardada." };
  } catch (error) {
    return fromError(error, "No se pudo guardar la fila.");
  }
}

/** Elimina una fila de la planilla de relevamiento (permiso `stock.relevamiento.editar`). */
export async function quitarFilaRelevamientoAction(
  arg1: StockActionState | string | { id: string },
  arg2?: FormData,
): Promise<StockActionState> {
  try {
    let id: string;
    if (arg2 instanceof FormData) {
      id = String(arg2.get("id") ?? "");
    } else if (typeof arg1 === "string") {
      id = arg1;
    } else if (arg1 && typeof arg1 === "object" && "id" in arg1) {
      id = arg1.id;
    } else {
      id = "";
    }
    await quitarFilaRelevamiento({ id });
    revalidatePath("/partidas/existencia-inicial");
    return { status: "success", message: "Fila eliminada." };
  } catch (error) {
    return fromError(error, "No se pudo quitar la fila.");
  }
}

export interface PasarAStockResultadoGrupo {
  grupoClave: string;
  drogaNombre?: string;
  lote?: string;
  ok: boolean;
  partidaId?: string;
  error?: string;
}

export type PasarAStockState =
  | {
      status: "idle";
    }
  | {
      status: "success";
      pasados: number;
      fallidos: number;
      restantes: number;
      resultados: PasarAStockResultadoGrupo[];
      message: string;
    }
  | {
      status: "error";
      message: string;
    }
  | {
      status: "operador-required";
    };

/**
 * Pasa hasta 100 grupos de filas completas a stock en transacciones individuales (R15).
 * Ejecuta bajo `conOperador` ya que `stock.partida.ingresar` es PIN-configurable.
 */
export async function pasarAStockAction(
  _prevState: StockActionState | PasarAStockState,
  formData: FormData,
): Promise<PasarAStockState> {
  return conOperador(formData, async (): Promise<PasarAStockState> => {
    try {
      const planilla = await getPlanillaRelevamiento();
      const filasValidas = planilla.filas.filter(
        (f) => f.estado.tipo === "lista" || f.estado.tipo === "se_suma",
      );

      const gruposMap = new Map<string, { drogaNombre: string; lote: string; filaIds: string[] }>();
      for (const f of filasValidas) {
        if (!f.drogaId || !f.lote) continue;
        const clave = claveGrupo(f.drogaId, f.lote, f.proveedorId);
        let g = gruposMap.get(clave);
        if (!g) {
          g = { drogaNombre: f.drogaNombre ?? "Droga", lote: f.lote, filaIds: [] };
          gruposMap.set(clave, g);
        }
        g.filaIds.push(f.id);
      }

      const todosLosGrupos = Array.from(gruposMap.entries());
      const gruposAProcesar = todosLosGrupos.slice(0, 100);
      const restantes = todosLosGrupos.length - gruposAProcesar.length;

      const resultados: PasarAStockResultadoGrupo[] = [];
      let pasados = 0;
      let fallidos = 0;

      for (const [clave, grupo] of gruposAProcesar) {
        try {
          const res = await pasarGrupoAStock({ filaIds: grupo.filaIds });
          pasados++;
          resultados.push({
            grupoClave: clave,
            drogaNombre: grupo.drogaNombre,
            lote: grupo.lote,
            ok: true,
            partidaId: res.partidaId,
          });
        } catch (err) {
          if (err instanceof OperadorRequeridoError) {
            return {
              status: "error",
              message: actionErrorMessage(err, "No se pudo pasar a stock."),
            };
          }
          fallidos++;
          resultados.push({
            grupoClave: clave,
            drogaNombre: grupo.drogaNombre,
            lote: grupo.lote,
            ok: false,
            error: actionErrorMessage(err, "No se pudo pasar a stock."),
          });
        }
      }

      revalidatePath("/stock");
      revalidatePath("/partidas");
      revalidatePath("/partidas/existencia-inicial");

      let message = `Se procesaron ${pasados + fallidos} grupos: ${pasados} pasados a stock.`;
      if (fallidos > 0) {
        message += ` ${fallidos} con error.`;
      }
      if (restantes > 0) {
        message += ` Quedan ${restantes} grupo(s) pendientes.`;
      }

      return {
        status: "success",
        pasados,
        fallidos,
        restantes,
        resultados,
        message,
      };
    } catch (error) {
      return {
        status: "error",
        message: actionErrorMessage(error, "No se pudo pasar a stock."),
      };
    }
  });
}



/** The consumed lots of "Elaborar lote": one `cantidad_<partidaId>` field per lot, blanks skipped (the command reports a rejected one by that same name). */
function consumosDelForm(formData: FormData): { partidaId: string; cantidad: string }[] {
  const consumos: { partidaId: string; cantidad: string }[] = [];
  for (const [key, value] of formData.entries()) {
    const match = /^cantidad_([0-9a-f-]{36})$/i.exec(key);
    if (match && String(value).trim() !== "") consumos.push({ partidaId: match[1]!, cantidad: String(value) });
  }
  return consumos;
}

/** "Elaborar lote" (openspec/changes/lotes-elaborados): one dilución or fórmula lot; returns the new partida to its dialog. */
export async function elaborarLoteAction(_prevState: StockActionState, formData: FormData): Promise<StockActionState> {
  return conOperador(formData, async (): Promise<StockActionState> => {
    try {
      const { partidaId } = await elaborarLote({
        tipo: String(formData.get("tipo") ?? "") as "DILUCION" | "FORMULA",
        drogaProducidaId: String(formData.get("drogaProducidaId") ?? ""),
        formulaId: opcional(formData, "formulaId"),
        cantidadProducida: String(formData.get("cantidadProducida") ?? ""),
        nombre: String(formData.get("nombre") ?? ""),
        aspecto: opcional(formData, "aspecto"),
        observacion: opcional(formData, "observacion"),
        consumos: consumosDelForm(formData),
      });
      revalidatePath("/stock");
      revalidatePath("/partidas");
      return { status: "success", message: "Lote elaborado: la partida ya está en el stock.", partidaId };
    } catch (error) {
      return fromError(error, "No se pudo elaborar el lote.");
    }
  });
}

export type DatosParaElaborarState = { status: "success"; datos: DatosParaElaborar } | { status: "error"; message: string };

/** The "Elaborar lote" form's data for a produced droga, refetched when the user adds a component droga. Read-only. */
/** The print dialog's sizes and sheet, for the "Imprimir etiqueta" offered once a lot is elaborated; `null` when the session may not print. */
export async function opcionesEtiquetaLoteAction(): Promise<{ tamanos: EtiquetaTamano[]; hoja: HojaEtiqueta } | null> {
  try {
    const [tamanos, hoja] = await Promise.all([listTamanosParaImprimir(), getHojaParaImprimir()]);
    return { tamanos: [...tamanos], hoja };
  } catch {
    return null;
  }
}

export async function datosParaElaborarAction(drogaProducidaId: string, drogaIds: string[] = []): Promise<DatosParaElaborarState> {
  try {
    return { status: "success", datos: await datosParaElaborar({ drogaProducidaId: String(drogaProducidaId), drogaIds: drogaIds.map(String) }) };
  } catch (error) {
    return { status: "error", message: actionErrorMessage(error, "No se pudieron cargar los lotes para elaborar.") };
  }
}

/** "Corregir cantidad inicial" (R17): adjusts initial quantity under conOperador. */
export async function corregirCantidadInicialAction(
  _prevState: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  return conOperador(formData, async (): Promise<StockActionState> => {
    const partidaId = String(formData.get("partidaId") ?? "");
    try {
      await corregirCantidadInicial({
        partidaId,
        cantidad: String(formData.get("cantidad") ?? ""),
        unidadId: String(formData.get("unidadId") ?? ""),
        observacion: opcional(formData, "observacion"),
        dtUsuarioId: opcional(formData, "dtUsuarioId"),
        dtPassword: opcional(formData, "dtPassword"),
      });
      revalidatePath("/partidas/existencia-inicial");
      revalidatePath("/stock");
      revalidatePath(`/partidas/${partidaId}`);
      return { status: "success", message: "Cantidad inicial corregida." };
    } catch (error) {
      return fromError(error, "No se pudo corregir la cantidad inicial.");
    }
  });
}

/** "Corregir datos de partida inicial" (R18): adjusts lote, vencimiento, proveedor of an unused partida under conOperador. */
export async function corregirDatosPartidaInicialAction(
  _prevState: StockActionState,
  formData: FormData,
): Promise<StockActionState> {
  return conOperador(formData, async (): Promise<StockActionState> => {
    const partidaId = String(formData.get("partidaId") ?? "");
    try {
      await corregirDatosPartidaInicial({
        partidaId,
        lote: String(formData.get("lote") ?? ""),
        fechaVencimiento: opcional(formData, "fechaVencimiento") ?? null,
        proveedorId: opcional(formData, "proveedorId") ?? null,
      });
      revalidatePath("/partidas/existencia-inicial");
      revalidatePath("/stock");
      revalidatePath(`/partidas/${partidaId}`);
      return { status: "success", message: "Datos de la partida inicial corregidos." };
    } catch (error) {
      return fromError(error, "No se pudieron corregir los datos de la partida.");
    }
  });
}

/** "Importar desde Excel" (R21): imports planilla rows from an .xlsx file. Not PIN-configurable. */
export async function importarPlanillaExcelAction(
  _prevState: ImportarPlanillaExcelState,
  formData: FormData,
): Promise<ImportarPlanillaExcelState> {
  try {
    const archivo = formData.get("archivo");
    const resultado = await importarPlanillaExcel({ archivo });
    revalidatePath("/partidas/existencia-inicial");
    const mensaje =
      resultado.filasImportadas === 1
        ? "Se importó 1 fila a la planilla."
        : `Se importaron ${resultado.filasImportadas} filas a la planilla.`;
    return {
      status: "success",
      message: mensaje,
      resultado,
    };
  } catch (error) {
    return {
      status: "error",
      message: actionErrorMessage(error, "No se pudo importar la planilla desde Excel."),
    };
  }
}

