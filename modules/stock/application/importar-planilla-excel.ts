/**
 * `importarPlanillaExcel` (openspec/changes/planilla-existencia-inicial R21).
 * Imports draft rows into the planilla de existencia inicial from an .xlsx spreadsheet.
 * Matches drogas by name or synonym, unidades by symbol/code, proveedores by CUIT or razón social.
 * Permiso `stock.relevamiento.editar` (not PIN-configurable).
 * Audited: `relevamiento_fila`, CREAR.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError, ValidationError } from "@/shared/errors";
import { dec, Decimal } from "@/shared/decimal";
import { interpretarNumero } from "@/shared/decimal/numero-ingresado";
import { normalizarTexto } from "@/modules/drogas/domain/normalizar";
import { listDrogasParaMatchingEnTx } from "@/modules/drogas/application/list-drogas-para-matching";
import { validarArchivoXlsx } from "@/shared/xlsx/validar-archivo-xlsx";
import { leerLibroXlsx } from "@/shared/xlsx/leer-xlsx.server";
import type { CeldaCruda } from "@/shared/xlsx/libro-hojas";
import { MENSAJE_RELEVAMIENTO_CERRADO } from "../domain/existencia-inicial";
import {
  lockTenantRelevamientoCompartido,
  relevamientoInicialAbierto,
} from "../infrastructure/existencia-inicial-repository";
import {
  createFilasRelevamiento,
  listProveedoresActivos,
  listUnidadesActivas,
  type UpsertFilaRelevamientoInput,
} from "../infrastructure/relevamiento-fila-repository";

const MAX_FILAS_IMPORTACION = 1000;

export interface CeldaNoReconocida {
  fila: number;
  columna: "Droga" | "Lote" | "Vencimiento" | "Cantidad" | "Unidad" | "Potencia" | "Costo" | "Proveedor";
  valor: string;
  motivo: string;
}

export interface ImportarPlanillaExcelResultado {
  filasImportadas: number;
  noReconocidos: CeldaNoReconocida[];
}

const importarPlanillaExcelInput = z.object({
  archivo: z.unknown(),
});

export type ImportarPlanillaExcelInput = z.input<typeof importarPlanillaExcelInput>;

function parsearFechaExcel(celda: unknown): { ok: true; fechaIso: string; date: Date } | { ok: false } {
  if (celda instanceof Date) {
    if (isNaN(celda.getTime())) return { ok: false };
    const y = celda.getUTCFullYear();
    const m = celda.getUTCMonth() + 1;
    const d = celda.getUTCDate();
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return { ok: true, fechaIso: iso, date: new Date(iso) };
  }
  if (typeof celda === "string" || typeof celda === "number") {
    const texto = String(celda).trim();
    if (!texto) return { ok: false };

    // dd/mm/aaaa or d/m/yyyy
    const matchDmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(texto);
    if (matchDmy) {
      const d = parseInt(matchDmy[1]!, 10);
      const m = parseInt(matchDmy[2]!, 10);
      const y = parseInt(matchDmy[3]!, 10);
      if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return { ok: false };
      const testDate = new Date(Date.UTC(y, m - 1, d));
      if (testDate.getUTCDate() !== d || testDate.getUTCMonth() !== m - 1 || testDate.getUTCFullYear() !== y) {
        return { ok: false };
      }
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { ok: true, fechaIso: iso, date: new Date(iso) };
    }

    // YYYY-MM-DD
    const matchIso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(texto);
    if (matchIso) {
      const y = parseInt(matchIso[1]!, 10);
      const m = parseInt(matchIso[2]!, 10);
      const d = parseInt(matchIso[3]!, 10);
      if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return { ok: false };
      const testDate = new Date(Date.UTC(y, m - 1, d));
      if (testDate.getUTCDate() !== d || testDate.getUTCMonth() !== m - 1 || testDate.getUTCFullYear() !== y) {
        return { ok: false };
      }
      const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      return { ok: true, fechaIso: iso, date: new Date(iso) };
    }
  }
  return { ok: false };
}

function esFilaVacia(fila: readonly CeldaCruda[]): boolean {
  return fila.every((celda) => {
    if (celda === null || celda === undefined) return true;
    if (typeof celda === "string" && celda.trim() === "") return true;
    return false;
  });
}

export const importarPlanillaExcelCommand = defineCommand({
  name: "stock.relevamiento.importar_excel",
  permiso: "stock.relevamiento.editar",
  input: importarPlanillaExcelInput,
  audit: { entidad: "relevamiento_fila", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    await lockTenantRelevamientoCompartido(tx, session.tenantId);
    const abierto = await relevamientoInicialAbierto(tx, session.tenantId);
    if (!abierto) {
      throw new DomainError(MENSAJE_RELEVAMIENTO_CERRADO);
    }

    const { bytes, nombreArchivo } = await validarArchivoXlsx(input.archivo);
    const libro = await leerLibroXlsx(bytes, { admitirFechas: true });

    if (libro.hojas.length === 0) {
      throw new ValidationError("El archivo no tiene hojas.");
    }

    const primeraHoja = libro.hojas[0]!;
    const filasCrudas = libro.leerHoja(primeraHoja.nombre);
    if (filasCrudas.length === 0) {
      throw new ValidationError("La hoja está vacía.");
    }

    // Match headers
    const encabezados = filasCrudas[0]!;
    let colDroga = -1;
    let colLote = -1;
    let colVencimiento = -1;
    let colCantidad = -1;
    let colUnidad = -1;
    let colPotencia = -1;
    let colCosto = -1;
    let colProveedor = -1;

    for (let c = 0; c < encabezados.length; c++) {
      const valor = encabezados[c];
      if (!valor || typeof valor !== "string") continue;
      const norm = normalizarTexto(valor);
      if (norm === "droga" || norm === "droga / insumo" || norm === "insumo") {
        colDroga = c;
      } else if (norm === "lote") {
        colLote = c;
      } else if (
        norm === "vencimiento" ||
        norm === "fecha vencimiento" ||
        norm === "fecha de vencimiento"
      ) {
        colVencimiento = c;
      } else if (norm === "cantidad") {
        colCantidad = c;
      } else if (norm === "unidad" || norm === "unidad de medida") {
        colUnidad = c;
      } else if (
        norm === "potencia" ||
        norm === "potencia declarada" ||
        norm === "pureza" ||
        norm === "pureza (%)"
      ) {
        colPotencia = c;
      } else if (norm === "costo" || norm === "costo unitario" || norm === "precio") {
        colCosto = c;
      } else if (norm === "proveedor" || norm === "razon social") {
        colProveedor = c;
      }
    }

    const faltantes: string[] = [];
    if (colDroga === -1) faltantes.push("Droga");
    if (colCantidad === -1) faltantes.push("Cantidad");
    if (faltantes.length > 0) {
      throw new ValidationError(
        `Falta la columna obligatoria «${faltantes.join("» y «")}» en la planilla.`,
      );
    }

    // Skip fully blank rows and count data rows
    const filasDatos: { filaExcel: number; celdas: readonly CeldaCruda[] }[] = [];
    for (let i = 1; i < filasCrudas.length; i++) {
      const fila = filasCrudas[i]!;
      if (esFilaVacia(fila)) continue;
      filasDatos.push({ filaExcel: i + 1, celdas: fila });
    }

    if (filasDatos.length > MAX_FILAS_IMPORTACION) {
      throw new ValidationError(
        `El archivo supera el máximo de ${MAX_FILAS_IMPORTACION} filas permitidas (contiene ${filasDatos.length} filas con datos).`,
      );
    }

    // Catalogs
    const [drogas, unidades, proveedores] = await Promise.all([
      listDrogasParaMatchingEnTx(tx, session.tenantId),
      listUnidadesActivas(tx),
      listProveedoresActivos(tx, session.tenantId),
    ]);

    const noReconocidos: CeldaNoReconocida[] = [];
    const filasParaCrear: UpsertFilaRelevamientoInput[] = [];

    for (const { filaExcel, celdas } of filasDatos) {
      // 1. Droga
      const rawDroga = celdas[colDroga];
      const textoDrogaLeido = rawDroga !== null && rawDroga !== undefined ? String(rawDroga).trim() : "";
      let drogaId: string | null = null;
      let textoDroga: string | null = null;
      let drogaMatch: (typeof drogas)[number] | null = null;

      if (textoDrogaLeido.length > 0) {
        const normDroga = normalizarTexto(textoDrogaLeido);
        const matches = drogas.filter(
          (d) =>
            normalizarTexto(d.nombre) === normDroga ||
            d.sinonimos.some((s) => normalizarTexto(s) === normDroga),
        );
        if (matches.length === 1) {
          drogaMatch = matches[0]!;
          drogaId = drogaMatch.id;
        } else if (matches.length === 0) {
          textoDroga = textoDrogaLeido;
          noReconocidos.push({
            fila: filaExcel,
            columna: "Droga",
            valor: textoDrogaLeido,
            motivo: "Droga no encontrada en el catálogo",
          });
        } else {
          textoDroga = textoDrogaLeido;
          noReconocidos.push({
            fila: filaExcel,
            columna: "Droga",
            valor: textoDrogaLeido,
            motivo: `Múltiples drogas coinciden (${matches.map((m) => m.nombre).join(", ")})`,
          });
        }
      } else {
        noReconocidos.push({
          fila: filaExcel,
          columna: "Droga",
          valor: "",
          motivo: "Celda de droga vacía",
        });
      }

      // 2. Lote
      const rawLote = colLote >= 0 ? celdas[colLote] : null;
      const lote = rawLote !== null && rawLote !== undefined ? String(rawLote).trim() || null : null;

      // 3. Vencimiento
      const rawVenc = colVencimiento >= 0 ? celdas[colVencimiento] : null;
      let fechaVencimiento: Date | null = null;
      if (rawVenc !== null && rawVenc !== undefined) {
        const textoVenc = typeof rawVenc === "string" ? rawVenc.trim() : String(rawVenc);
        if (textoVenc !== "") {
          const parsed = parsearFechaExcel(rawVenc);
          if (parsed.ok) {
            fechaVencimiento = parsed.date;
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Vencimiento",
              valor: textoVenc,
              motivo: "Fecha no válida (usar dd/mm/aaaa)",
            });
          }
        }
      }

      // 4. Cantidad
      const rawCantidad = celdas[colCantidad];
      let cantidad: Decimal | null = null;
      if (rawCantidad !== null && rawCantidad !== undefined) {
        if (typeof rawCantidad === "number") {
          if (Number.isFinite(rawCantidad) && new Decimal(String(rawCantidad)).gt(0)) {
            cantidad = new Decimal(String(rawCantidad));
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Cantidad",
              valor: String(rawCantidad),
              motivo: "La cantidad debe ser mayor a 0",
            });
          }
        } else if (typeof rawCantidad === "string") {
          const textoCantidad = rawCantidad.trim();
          if (textoCantidad !== "") {
            const num = interpretarNumero(textoCantidad);
            if (num.ok && dec(num.valor).gt(0)) {
              cantidad = dec(num.valor);
            } else {
              noReconocidos.push({
                fila: filaExcel,
                columna: "Cantidad",
                valor: textoCantidad,
                motivo: num.ok ? "La cantidad debe ser mayor a 0" : num.mensaje,
              });
            }
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Cantidad",
              valor: "",
              motivo: "Cantidad vacía",
            });
          }
        } else {
          noReconocidos.push({
            fila: filaExcel,
            columna: "Cantidad",
            valor: String(rawCantidad),
            motivo: "Cantidad inválida",
          });
        }
      } else {
        noReconocidos.push({
          fila: filaExcel,
          columna: "Cantidad",
          valor: "",
          motivo: "Cantidad vacía",
        });
      }

      // 5. Unidad
      const rawUnidad = colUnidad >= 0 ? celdas[colUnidad] : null;
      let unidadMedidaId: string | null = null;
      if (rawUnidad !== null && rawUnidad !== undefined) {
        const textoUnidad = String(rawUnidad).trim();
        if (textoUnidad !== "") {
          const normUnidad = normalizarTexto(textoUnidad);
          const uMatch =
            unidades.find((u) => normalizarTexto(u.simbolo) === normUnidad) ??
            unidades.find((u) => normalizarTexto(u.codigo) === normUnidad) ??
            unidades.find((u) => normalizarTexto(u.nombre) === normUnidad);

          if (!uMatch) {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Unidad",
              valor: textoUnidad,
              motivo: "Unidad no reconocida en el catálogo",
            });
          } else if (drogaMatch && uMatch.tipoMagnitud !== drogaMatch.tipoMagnitud) {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Unidad",
              valor: textoUnidad,
              motivo: `La unidad «${uMatch.simbolo}» no es compatible con la magnitud de la droga (${drogaMatch.tipoMagnitud})`,
            });
          } else {
            unidadMedidaId = uMatch.id;
          }
        }
      }

      // 6. Potencia
      const rawPotencia = colPotencia >= 0 ? celdas[colPotencia] : null;
      let potenciaDeclarada: Decimal | null = null;
      if (rawPotencia !== null && rawPotencia !== undefined) {
        if (typeof rawPotencia === "number") {
          if (
            Number.isFinite(rawPotencia) &&
            new Decimal(String(rawPotencia)).gte(0) &&
            new Decimal(String(rawPotencia)).lte(100)
          ) {
            potenciaDeclarada = new Decimal(String(rawPotencia));
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Potencia",
              valor: String(rawPotencia),
              motivo: "La potencia debe estar entre 0 y 100",
            });
          }
        } else if (typeof rawPotencia === "string") {
          const textoPotencia = rawPotencia.trim();
          if (textoPotencia !== "") {
            const num = interpretarNumero(textoPotencia);
            if (num.ok && dec(num.valor).gte(0) && dec(num.valor).lte(100)) {
              potenciaDeclarada = dec(num.valor);
            } else {
              noReconocidos.push({
                fila: filaExcel,
                columna: "Potencia",
                valor: textoPotencia,
                motivo: num.ok ? "La potencia debe estar entre 0 y 100" : num.mensaje,
              });
            }
          }
        } else {
          noReconocidos.push({
            fila: filaExcel,
            columna: "Potencia",
            valor: String(rawPotencia),
            motivo: "Potencia inválida",
          });
        }
      }

      // 7. Costo
      const rawCosto = colCosto >= 0 ? celdas[colCosto] : null;
      let costoUnitario: Decimal | null = null;
      if (rawCosto !== null && rawCosto !== undefined) {
        if (typeof rawCosto === "number") {
          if (Number.isFinite(rawCosto) && new Decimal(String(rawCosto)).gte(0)) {
            costoUnitario = new Decimal(String(rawCosto));
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Costo",
              valor: String(rawCosto),
              motivo: "El costo debe ser mayor o igual a 0",
            });
          }
        } else if (typeof rawCosto === "string") {
          const textoCosto = rawCosto.trim().replace(/^\s*\$\s*/, "");
          if (textoCosto !== "") {
            const num = interpretarNumero(textoCosto);
            if (num.ok && dec(num.valor).gte(0)) {
              costoUnitario = dec(num.valor);
            } else {
              noReconocidos.push({
                fila: filaExcel,
                columna: "Costo",
                valor: textoCosto,
                motivo: num.ok ? "El costo debe ser mayor o igual a 0" : num.mensaje,
              });
            }
          }
        } else {
          noReconocidos.push({
            fila: filaExcel,
            columna: "Costo",
            valor: String(rawCosto),
            motivo: "Costo inválido",
          });
        }
      }

      // 8. Proveedor
      const rawProveedor = colProveedor >= 0 ? celdas[colProveedor] : null;
      let proveedorId: string | null = null;
      if (rawProveedor !== null && rawProveedor !== undefined) {
        const textoProveedor = String(rawProveedor).trim();
        if (textoProveedor !== "") {
          const cuitLimpio = textoProveedor.replace(/\D/g, "");
          const normProv = normalizarTexto(textoProveedor);
          const provMatch = proveedores.find(
            (p) =>
              (cuitLimpio.length === 11 && p.cuit === cuitLimpio) ||
              normalizarTexto(p.razonSocial) === normProv,
          );
          if (provMatch) {
            proveedorId = provMatch.id;
          } else {
            noReconocidos.push({
              fila: filaExcel,
              columna: "Proveedor",
              valor: textoProveedor,
              motivo: "Proveedor no encontrado por razón social ni CUIT",
            });
          }
        }
      }

      filasParaCrear.push({
        id: crypto.randomUUID(),
        tenantId: session.tenantId,
        drogaId,
        lote,
        fechaVencimiento,
        cantidad,
        unidadMedidaId,
        potenciaDeclarada,
        costoUnitario,
        proveedorId,
        textoDroga,
        creadoPorId: session.usuario.id,
      });
    }

    if (filasParaCrear.length > 0) {
      await createFilasRelevamiento(tx, filasParaCrear);
    }

    const resultado: ImportarPlanillaExcelResultado = {
      filasImportadas: filasParaCrear.length,
      noReconocidos,
    };

    return {
      output: resultado,
      audit: {
        entidadId: session.tenantId,
        contexto: {
          nombreArchivo,
          filasImportadas: filasParaCrear.length,
          noReconocidos: noReconocidos.length,
        },
        valorNuevo: {
          nombreArchivo,
          filasImportadas: filasParaCrear.length,
          noReconocidos: noReconocidos.length,
        },
      },
    };
  },
});

export async function importarPlanillaExcel(
  input: ImportarPlanillaExcelInput,
): Promise<ImportarPlanillaExcelResultado> {
  return importarPlanillaExcelCommand.execute(input);
}
