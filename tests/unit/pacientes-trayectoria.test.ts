/**
 * Unit tests for `modules/pacientes/domain/trayectoria.ts`: pure derivation
 * of the paciente Trayectoria (journey steps, resumen, presupuesto, asiento
 * visual state, pagination). No mocks, no DB.
 */
import { describe, it, expect } from "vitest";
import {
  PAGE_SIZE_TRAYECTORIA,
  armarRecetasTrayectoria,
  armarTrayectoria,
  calcularPaginacion,
  calcularPresupuesto,
  calcularResumen,
  cotizacionVigentePorItem,
  estadoPasoArchivo,
  estadoPasoEntrega,
  estadoPasoLibro,
  estadoPasoPreparacion,
  formatearMonto,
} from "@/modules/pacientes/domain/trayectoria";
import type {
  AccesoTrayectoria,
  AsientoItemTrayectoria,
  AsientoCrudo,
  CotizacionCruda,
  GrupoRecetasCrudo,
  ItemTrayectoria,
  PreparacionCruda,
  RecetaCruda,
  TrayectoriaCruda,
} from "@/modules/pacientes/domain/trayectoria";

const dia = (iso: string) => new Date(`${iso}T12:00:00Z`);

const ACCESO_TOTAL: AccesoTrayectoria = { presupuesto: true, preparacion: true, libro: true, archivo: true, linkReceta: true, linkEntrega: true };
const ACCESO_BASE: AccesoTrayectoria = { presupuesto: false, preparacion: false, libro: false, archivo: false, linkReceta: false, linkEntrega: false };

describe("calcularResumen", () => {
  const grupos: GrupoRecetasCrudo[] = [
    { estado: "PENDIENTE_PREPARACION", cantidad: 2, ultimaIngreso: dia("2026-09-29") },
    { estado: "EN_PREPARACION", cantidad: 1, ultimaIngreso: dia("2026-09-25") },
    { estado: "ENTREGADA", cantidad: 3, ultimaIngreso: dia("2026-09-30") },
    { estado: "ENTREGADA", cantidad: 1, ultimaIngreso: dia("2026-09-10") },
    { estado: "ANULADA", cantidad: 2, ultimaIngreso: dia("2026-02-02") },
  ];

  it("counts every receta, and the en curso / entregadas / anuladas buckets", () => {
    const r = calcularResumen(grupos);
    expect(r.total).toBe(9);
    expect(r.enCurso).toBe(3); // PENDIENTE_PREPARACION x2 + EN_PREPARACION x1
    expect(r.entregadas).toBe(4);
    expect(r.anuladas).toBe(2);
  });

  it("ultima atencion is the max fechaIngreso over all groups", () => {
    expect(calcularResumen(grupos).ultimaAtencion).toEqual(dia("2026-09-30"));
  });

  it("an empty paciente has zeros, no oldest debt and no ultima atencion", () => {
    expect(calcularResumen([])).toEqual({
      total: 0,
      enCurso: 0,
      entregadas: 0,
      anuladas: 0,
      ultimaAtencion: null,
    });
  });
});

describe("calcularPaginacion", () => {
  it("uses 10 recetas per page by default and rounds the page count up", () => {
    expect(PAGE_SIZE_TRAYECTORIA).toBe(10);
    expect(calcularPaginacion(23, 2)).toEqual({ page: 2, pageSize: 10, total: 23, totalPages: 3 });
  });

  it("clamps an out-of-range page and keeps one page for an empty result", () => {
    expect(calcularPaginacion(23, 99).page).toBe(3);
    expect(calcularPaginacion(23, 0).page).toBe(1);
    expect(calcularPaginacion(0, 5)).toEqual({ page: 1, pageSize: 10, total: 0, totalPages: 1 });
  });
});

describe("presupuesto (latest cotizacion per item, INV-R06)", () => {
  const cot = (itemRecetaId: string, precioFinal: string, calculadaEn: string, extra: Partial<CotizacionCruda> = {}): CotizacionCruda => ({
    itemRecetaId,
    precioFinal,
    esParcial: false,
    esIncompleta: false,
    calculadaEn: new Date(calculadaEn),
    ...extra,
  });

  it("keeps only the highest calculadaEn of each item", () => {
    const vigente = cotizacionVigentePorItem([cot("a", "100", "2026-09-01T10:00:00Z"), cot("a", "150", "2026-09-02T10:00:00Z"), cot("a", "120", "2026-09-01T12:00:00Z")]);
    expect(vigente.get("a")?.precioFinal).toBe("150");
  });

  it("sums the vigente price of every item exactly (no float drift)", () => {
    const p = calcularPresupuesto(["a", "b"], [cot("a", "0.1", "2026-09-01T10:00:00Z"), cot("b", "0.2", "2026-09-01T10:00:00Z"), cot("a", "10.10", "2026-09-02T10:00:00Z")]);
    expect(p).toEqual({ total: "10.3", itemsCotizados: 2, itemsSinCotizar: 0, esParcial: false, esIncompleta: false });
  });

  it("flags the total as partial/incomplete when any cotizado item is, and counts items without cotizacion", () => {
    const p = calcularPresupuesto(
      ["a", "b", "c"],
      [cot("a", "100", "2026-09-01T10:00:00Z", { esParcial: true }), cot("b", "50", "2026-09-01T10:00:00Z", { esIncompleta: true })],
    );
    expect(p).toMatchObject({ total: "150", itemsCotizados: 2, itemsSinCotizar: 1, esParcial: true, esIncompleta: true });
  });

  it("an OLD partial cotizacion does not taint a newer complete one", () => {
    const p = calcularPresupuesto(["a"], [cot("a", "80", "2026-09-01T10:00:00Z", { esParcial: true }), cot("a", "90", "2026-09-02T10:00:00Z")]);
    expect(p).toMatchObject({ total: "90", esParcial: false });
  });

  it("is null when no item was ever cotizado, and ignores cotizaciones of other items", () => {
    expect(calcularPresupuesto(["a"], [])).toBeNull();
    expect(calcularPresupuesto(["a"], [cot("zzz", "500", "2026-09-01T10:00:00Z")])).toBeNull();
  });

  it("formats money as es-AR with two decimals", () => {
    expect(formatearMonto("1234.5")).toBe("1.234,50");
    expect(formatearMonto("0")).toBe("0,00");
    expect(formatearMonto("1234567.891")).toBe("1.234.567,89");
    expect(formatearMonto("-1500")).toBe("-1.500,00");
  });
});

describe("journey steps", () => {
  const prep = (estado: "INICIADA" | "CONFIRMADA" | "DESCARTADA") => [{ estado }] as unknown as ItemTrayectoria["preparaciones"];
  const asiento = (estadoVisual: AsientoItemTrayectoria["estadoVisual"]) => ({ estadoVisual }) as AsientoItemTrayectoria;

  it("preparacion: COMPLETO only when every item is confirmed, EN_CURSO for partial or iniciada, PENDIENTE otherwise", () => {
    expect(estadoPasoPreparacion("LISTA_PARA_RETIRAR", [{ preparaciones: prep("CONFIRMADA") }, { preparaciones: prep("CONFIRMADA") }])).toBe("COMPLETO");
    expect(estadoPasoPreparacion("EN_PREPARACION", [{ preparaciones: prep("CONFIRMADA") }, { preparaciones: [] }])).toBe("EN_CURSO");
    expect(estadoPasoPreparacion("EN_PREPARACION", [{ preparaciones: prep("INICIADA") }])).toBe("EN_CURSO");
    expect(estadoPasoPreparacion("PENDIENTE_PREPARACION", [{ preparaciones: [] }])).toBe("PENDIENTE");
    // a discarded preparacion alone does not advance the step
    expect(estadoPasoPreparacion("PENDIENTE_PREPARACION", [{ preparaciones: prep("DESCARTADA") }])).toBe("PENDIENTE");
  });

  it("preparacion on an ANULADA receta that never got there is NO_APLICA, a completed one stays COMPLETO", () => {
    expect(estadoPasoPreparacion("ANULADA", [{ preparaciones: [] }])).toBe("NO_APLICA");
    expect(estadoPasoPreparacion("ANULADA", [{ preparaciones: prep("CONFIRMADA") }])).toBe("COMPLETO");
  });

  it("libro: COMPLETO when every asiento is vigente, SIN_EFECTO when none is, EN_CURSO in between, PENDIENTE without asientos", () => {
    expect(estadoPasoLibro("ENTREGADA", [{ asiento: asiento("VIGENTE") }, { asiento: asiento("VIGENTE") }])).toBe("COMPLETO");
    expect(estadoPasoLibro("ENTREGADA", [{ asiento: asiento("ANULADO") }, { asiento: asiento("SIN_EFECTO") }])).toBe("SIN_EFECTO");
    expect(estadoPasoLibro("EN_PREPARACION", [{ asiento: asiento("VIGENTE") }, { asiento: null }])).toBe("EN_CURSO");
    expect(estadoPasoLibro("EN_PREPARACION", [{ asiento: asiento("VIGENTE") }, { asiento: asiento("SIN_EFECTO") }])).toBe("EN_CURSO");
    // none in effect but another item has no asiento yet: the step is still open, not SIN_EFECTO
    expect(estadoPasoLibro("EN_PREPARACION", [{ asiento: asiento("ANULADO") }, { asiento: null }])).toBe("EN_CURSO");
    expect(estadoPasoLibro("EN_PREPARACION", [{ asiento: asiento("SIN_EFECTO") }, { asiento: null }])).toBe("EN_CURSO");
    expect(estadoPasoLibro("PENDIENTE_PREPARACION", [{ asiento: null }])).toBe("PENDIENTE");
    expect(estadoPasoLibro("ANULADA", [{ asiento: null }])).toBe("NO_APLICA");
    expect(estadoPasoLibro("ANULADA", [{ asiento: asiento("SIN_EFECTO") }])).toBe("SIN_EFECTO");
  });

  it("entrega: COMPLETO when delivered, EN_CURSO for an ENVIO still waiting for the firma, PENDIENTE/NO_APLICA without entrega", () => {
    expect(estadoPasoEntrega("ENTREGADA", { modalidad: "RETIRO_PRESENCIAL", firmaRecibida: false })).toBe("COMPLETO");
    expect(estadoPasoEntrega("ENVIADA_PEND_FIRMA", { modalidad: "ENVIO", firmaRecibida: false })).toBe("EN_CURSO");
    expect(estadoPasoEntrega("ENTREGADA", { modalidad: "ENVIO", firmaRecibida: true })).toBe("COMPLETO");
    expect(estadoPasoEntrega("PREPARADA", null)).toBe("PENDIENTE");
    expect(estadoPasoEntrega("ANULADA", null)).toBe("NO_APLICA");
  });

  it("archivo: COMPLETO with a lote, PENDIENTE otherwise (it no longer waits on anything but the lote)", () => {
    expect(estadoPasoArchivo({ id: "l", numero: "4", estado: "EN_ARCHIVO" })).toBe("COMPLETO");
    expect(estadoPasoArchivo(null)).toBe("PENDIENTE");
  });
});

describe("armarRecetasTrayectoria / armarTrayectoria", () => {
  const receta = (id: string, extra: Partial<RecetaCruda> = {}): RecetaCruda => ({
    id,
    numeroInterno: "101",
    fechaIngreso: dia("2026-09-20"),
    fechaPrescripcion: dia("2026-09-19"),
    medicoNombre: "Ana",
    medicoApellido: "Gómez",
    origen: "PRESENCIAL",
    estado: "ENTREGADA",
    motivoAnulacion: null,
    loteArchivoId: null,
    ...extra,
  });
  const prepCruda = (id: string, itemRecetaId: string, extra: Partial<PreparacionCruda> = {}): PreparacionCruda => ({
    id,
    itemRecetaId,
    estado: "CONFIRMADA",
    iniciadaEn: new Date("2026-09-21T10:00:00Z"),
    confirmadaEn: new Date("2026-09-21T11:00:00Z"),
    descartadaEn: null,
    motivoDescarte: null,
    ...extra,
  });
  const asientoCrudo = (extra: Partial<AsientoCrudo> = {}): AsientoCrudo => ({
    id: "as1",
    itemRecetaId: "i1",
    numeroCorrelativo: "57",
    fechaAsiento: dia("2026-09-21"),
    estado: "VIGENTE",
    anulacion: null,
    rectificativoNumeroCorrelativo: null,
    ...extra,
  });

  function cruda(extra: Partial<TrayectoriaCruda> = {}): TrayectoriaCruda {
    return {
      paciente: { id: "p1", nombre: "Juan", apellido: "Pérez", dni: "30123456", nroCredencial: null, fechaBaja: null, motivoBaja: null },
      grupos: [{ estado: "ENTREGADA", cantidad: 1, ultimaIngreso: dia("2026-09-20") }],
      recetas: [receta("r1", { loteArchivoId: "l1" })],
      page: 1,
      zonaHoraria: "America/Argentina/Mendoza",
      items: [{ id: "i1", recetaId: "r1", descripcion: null, formaFarmaceutica: "CAPSULA", cantidadUnidades: 30, drogas: ["Ibuprofeno", "Lactosa"] }],
      cotizaciones: [{ itemRecetaId: "i1", precioFinal: "1500.50", esParcial: false, esIncompleta: false, calculadaEn: new Date("2026-09-20T10:00:00Z") }],
      preparaciones: [prepCruda("pr1", "i1")],
      asientos: [asientoCrudo()],
      entregas: [{ recetaId: "r1", modalidad: "RETIRO_PRESENCIAL", entregadaEn: new Date("2026-09-22T10:00:00Z"), firmaRecibida: true, firmaRecibidaEn: new Date("2026-09-22T10:00:00Z") }],
      lotes: [{ id: "l1", numero: "7", estado: "EN_ARCHIVO" }],
      ...extra,
    };
  }

  it("builds the full journey of a delivered, archived receta", () => {
    const [r] = armarRecetasTrayectoria(cruda(), ACCESO_TOTAL);
    expect(r!.pasos).toEqual([
      { paso: "INGRESO", estado: "COMPLETO" },
      { paso: "PREPARACION", estado: "COMPLETO" },
      { paso: "LIBRO", estado: "COMPLETO" },
      { paso: "ENTREGA", estado: "COMPLETO" },
      { paso: "ARCHIVO", estado: "COMPLETO" },
    ]);
    expect(r!.medico).toBe("Gómez, Ana");
    expect(r!.items[0]).toMatchObject({ drogas: ["Ibuprofeno", "Lactosa"], cotizacion: { precioFinal: "1500.50" } });
    expect(r!.items[0]!.asiento).toMatchObject({ numeroCorrelativo: "57", estadoVisual: "VIGENTE", etiquetaEstado: "Vigente" });
    expect(r!.presupuesto).toMatchObject({ total: "1500.5", itemsSinCotizar: 0 });
    expect(r!.entrega).toMatchObject({ modalidad: "RETIRO_PRESENCIAL", firmaRecibida: true });
    expect(r!.lote).toEqual({ id: "l1", numero: "7", estado: "EN_ARCHIVO" });
  });

  it("reuses the libro rule for the asiento's visual state (rectificativo -> sin efecto, ANULADO with anulacion -> anulado)", () => {
    const sinEfecto = armarRecetasTrayectoria(cruda({ asientos: [asientoCrudo({ rectificativoNumeroCorrelativo: "60" })] }), ACCESO_TOTAL)[0]!;
    expect(sinEfecto.items[0]!.asiento).toMatchObject({ estadoVisual: "SIN_EFECTO", etiquetaEstado: "Sin efecto por asiento Nº 60" });
    expect(sinEfecto.pasos.find((p) => p.paso === "LIBRO")!.estado).toBe("SIN_EFECTO");

    const anulado = armarRecetasTrayectoria(
      cruda({ asientos: [asientoCrudo({ estado: "ANULADO", anulacion: { motivo: "Error de carga", anuladoEn: new Date("2026-09-22T10:00:00Z") } })] }),
      ACCESO_TOTAL,
    )[0]!;
    expect(anulado.items[0]!.asiento).toMatchObject({ estadoVisual: "ANULADO", etiquetaEstado: "Anulado" });
  });

  it("omits the steps of blocks the session cannot see, and exposes no data for them", () => {
    const [r] = armarRecetasTrayectoria(cruda({ cotizaciones: [], preparaciones: [], asientos: [], lotes: [] }), ACCESO_BASE);
    expect(r!.pasos.map((p) => p.paso)).toEqual(["INGRESO", "ENTREGA"]);
    expect(r!.presupuesto).toBeNull();
    expect(r!.items[0]).toMatchObject({ cotizacion: null, preparaciones: [], asiento: null });
    expect(r!.lote).toBeNull();
  });

  it("never computes a presupuesto without access, even if cotizaciones were (wrongly) supplied", () => {
    const [r] = armarRecetasTrayectoria(cruda(), { ...ACCESO_TOTAL, presupuesto: false });
    expect(r!.presupuesto).toBeNull();
  });

  it("orders each item's preparaciones oldest first and keeps the discard reason", () => {
    const [r] = armarRecetasTrayectoria(
      cruda({
        preparaciones: [
          prepCruda("pr2", "i1", { iniciadaEn: new Date("2026-09-22T10:00:00Z") }),
          prepCruda("pr1", "i1", { estado: "DESCARTADA", iniciadaEn: new Date("2026-09-21T10:00:00Z"), confirmadaEn: null, descartadaEn: new Date("2026-09-21T10:30:00Z"), motivoDescarte: "Pesaje incorrecto" }),
        ],
      }),
      ACCESO_TOTAL,
    );
    expect(r!.items[0]!.preparaciones.map((p) => p.id)).toEqual(["pr1", "pr2"]);
    expect(r!.items[0]!.preparaciones[0]).toMatchObject({ estado: "DESCARTADA", motivoDescarte: "Pesaje incorrecto" });
  });

  it("an ANULADA receta keeps its motivo and shows the steps it never reached as NO_APLICA (Archivo stays PENDIENTE: ANULADA recetas are archivable)", () => {
    const [r] = armarRecetasTrayectoria(
      cruda({
        recetas: [receta("r1", { estado: "ANULADA", motivoAnulacion: "Duplicada" })],
        preparaciones: [],
        asientos: [],
        entregas: [],
        lotes: [],
      }),
      ACCESO_TOTAL,
    );
    expect(r!.motivoAnulacion).toBe("Duplicada");
    expect(r!.pasos.map((p) => p.estado)).toEqual(["COMPLETO", "NO_APLICA", "NO_APLICA", "NO_APLICA", "PENDIENTE"]);
  });

  it("the view model has no receta física concept (dropped by the client, 2026-10-01)", () => {
    const t = armarTrayectoria(cruda(), ACCESO_TOTAL);
    expect(JSON.stringify(t)).not.toMatch(/f[ií]sic/i);
    expect(Object.keys(t.resumen).sort()).toEqual(["anuladas", "enCurso", "entregadas", "total", "ultimaAtencion"]);
    expect(t.recetas[0]!.pasos.map((p) => p.paso)).toEqual(["INGRESO", "PREPARACION", "LIBRO", "ENTREGA", "ARCHIVO"]);
  });

  it("armarTrayectoria combines resumen, clamped pagination and the recetas", () => {
    const t = armarTrayectoria(cruda({ page: 1 }), ACCESO_TOTAL);
    expect(t.resumen.total).toBe(1);
    expect(t.paginacion).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(t.recetas).toHaveLength(1);
    expect(t.zonaHoraria).toBe("America/Argentina/Mendoza");
    expect(t.acceso).toEqual(ACCESO_TOTAL);
  });

  it("an empty paciente yields an empty page", () => {
    const t = armarTrayectoria(cruda({ grupos: [], recetas: [], items: [], cotizaciones: [], preparaciones: [], asientos: [], entregas: [], lotes: [] }), ACCESO_TOTAL);
    expect(t.recetas).toEqual([]);
    expect(t.resumen.total).toBe(0);
    expect(t.paginacion.totalPages).toBe(1);
  });
});
