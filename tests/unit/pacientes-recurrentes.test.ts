/**
 * Unit tests for `modules/pacientes/domain/recurrentes.ts`: pure derivation of
 * the "Pacientes recurrentes" view (fórmula signature, grouping, interval,
 * próxima fecha, estado, ordering) and the WhatsApp helpers (phone
 * normalization, message, wa.me URL). No mocks, no DB.
 *
 * Time zone used throughout: America/Argentina/Mendoza (UTC-3, no DST), so a
 * local calendar day differs from the UTC one between 21:00 and 24:00 local.
 */
import { describe, it, expect } from "vitest";
import {
  DIAS_ESTA_SEMANA,
  MAX_DESCRIPCION_CARACTERES,
  acotarTexto,
  FACTOR_DESCARTE_ATRASADO,
  calcularRecurrentes,
  compararRecurrentes,
  construirMensajeRecordatorio,
  construirUrlWhatsapp,
  describirQuePide,
  esAtrasoDescartable,
  estadoRecurrente,
  evaluarWhatsapp,
  filtrarPorVentana,
  firmaFormula,
  inicioVentanaRecurrentes,
  intervaloTipicoDias,
  mediana,
  normalizarTelefonoWhatsappAR,
  restarMeses,
} from "@/modules/pacientes/domain/recurrentes";
import type { ComponenteRecurrenteCrudo, ItemRecurrenteCrudo, PacienteRecurrenteCrudo, RecurrenteFila } from "@/modules/pacientes/domain/recurrentes";

const TZ = "America/Argentina/Mendoza";
const MS_DIA = 86_400_000;

/** A calendar day of the farmacia ("YYYY-MM-DD") as an ingreso at 12:00 local (15:00 UTC). */
const ingresoLocal = (jornada: string) => new Date(`${jornada}T15:00:00Z`);
/** `ahora` at 12:00 local of the given farmacia day. */
const hoyLocal = (jornada: string) => ingresoLocal(jornada);
/** Day number -> "YYYY-MM-DD" shifted by `dias` (pure calendar arithmetic). */
const sumarDias = (jornada: string, dias: number) => new Date(Date.parse(`${jornada}T00:00:00Z`) + dias * MS_DIA).toISOString().slice(0, 10);

const MELATONINA: ComponenteRecurrenteCrudo = { drogaId: "droga-mel", drogaNombre: "Melatonina", cantidad: "3", unidadMedidaId: "u-mg", unidadSimbolo: "mg", modoExpresion: "TOTAL" };
const MAGNESIO: ComponenteRecurrenteCrudo = { drogaId: "droga-mag", drogaNombre: "Magnesio", cantidad: "100", unidadMedidaId: "u-mg", unidadSimbolo: "mg", modoExpresion: "TOTAL" };
const EXCIPIENTE: ComponenteRecurrenteCrudo = { drogaId: "droga-lac", drogaNombre: "Lactosa", cantidad: null, unidadMedidaId: "u-mg", unidadSimbolo: "mg", modoExpresion: "CSP" };

const ANA: PacienteRecurrenteCrudo = { id: "pac-ana", nombre: "Ana", apellido: "Suárez", telefono: "011 15-1234-5678", aceptaRecordatoriosWhatsapp: true, fechaBaja: null };
const BETO: PacienteRecurrenteCrudo = { id: "pac-beto", nombre: "Beto", apellido: "Álvarez", telefono: null, aceptaRecordatoriosWhatsapp: false, fechaBaja: null };

let secuencia = 0;
function item(over: {
  recetaId: string;
  /** Local calendar day of the ingreso (12:00 local); omit when `ingreso` is given. */
  dia?: string;
  paciente?: PacienteRecurrenteCrudo;
  componentes?: ComponenteRecurrenteCrudo[];
  forma?: ItemRecurrenteCrudo["formaFarmaceutica"];
  estado?: ItemRecurrenteCrudo["receta"]["estado"];
  duracion?: number | null;
  descripcion?: string | null;
  id?: string;
  ingreso?: Date;
}): ItemRecurrenteCrudo {
  secuencia += 1;
  return {
    id: over.id ?? `item-${String(secuencia).padStart(4, "0")}`,
    descripcion: over.descripcion ?? null,
    formaFarmaceutica: over.forma ?? "CAPSULA",
    duracionTratamientoDias: over.duracion ?? null,
    componentes: over.componentes ?? [MELATONINA],
    receta: { id: over.recetaId, fechaIngreso: over.ingreso ?? ingresoLocal(over.dia!), estado: over.estado ?? "ENTREGADA" },
    paciente: over.paciente ?? ANA,
  };
}

/** Two recetas `gap` days apart, the latest on `ultimoDia`. */
function dosRecetas(ultimoDia: string, gap: number, extra: Partial<Parameters<typeof item>[0]> = {}) {
  return [item({ recetaId: "r-viejo", dia: sumarDias(ultimoDia, -gap), ...extra }), item({ recetaId: "r-nuevo", dia: ultimoDia, ...extra })];
}

describe("firmaFormula", () => {
  const base = { formaFarmaceutica: "CAPSULA" as const, componentes: [MELATONINA, MAGNESIO] };

  it("ignores the order of the componentes", () => {
    expect(firmaFormula({ ...base, componentes: [MAGNESIO, MELATONINA] })).toBe(firmaFormula(base));
  });

  it("compares cantidad as a number: 0.50 and 0.5 are the same, 3 and 4 are not", () => {
    const a = { ...base, componentes: [{ ...MELATONINA, cantidad: "0.50" }] };
    const b = { ...base, componentes: [{ ...MELATONINA, cantidad: "0.5" }] };
    expect(firmaFormula(a)).toBe(firmaFormula(b));
    expect(firmaFormula({ ...base, componentes: [{ ...MELATONINA, cantidad: "4" }] })).not.toBe(firmaFormula({ ...base, componentes: [MELATONINA] }));
  });

  it("a different forma, droga, unidad or modo is a different fórmula", () => {
    const una = { ...base, componentes: [MELATONINA] };
    expect(firmaFormula({ ...una, formaFarmaceutica: "COMPRIMIDO" })).not.toBe(firmaFormula(una));
    expect(firmaFormula({ ...una, componentes: [{ ...MELATONINA, drogaId: "otra" }] })).not.toBe(firmaFormula(una));
    expect(firmaFormula({ ...una, componentes: [{ ...MELATONINA, unidadMedidaId: "u-g" }] })).not.toBe(firmaFormula(una));
    expect(firmaFormula({ ...una, componentes: [{ ...MELATONINA, modoExpresion: "POR_DOSIS" }] })).not.toBe(firmaFormula(una));
  });

  it("a null cantidad (c.s.p.) differs from a numeric one and does not throw", () => {
    expect(firmaFormula({ ...base, componentes: [EXCIPIENTE] })).not.toBe(firmaFormula({ ...base, componentes: [{ ...EXCIPIENTE, cantidad: "0" }] }));
  });
});

describe("window helpers", () => {
  it("restarMeses subtracts calendar months and clamps the day", () => {
    expect(restarMeses("2026-10-01", 12)).toBe("2025-10-01");
    expect(restarMeses("2026-03-31", 1)).toBe("2026-02-28");
    expect(restarMeses("2028-02-29", 12)).toBe("2027-02-28");
    expect(restarMeses("2026-01-15", 2)).toBe("2025-11-15");
  });

  it("inicioVentanaRecurrentes is local midnight of today minus 12 months (Mendoza = 03:00Z)", () => {
    expect(inicioVentanaRecurrentes(hoyLocal("2026-10-01"), TZ).toISOString()).toBe("2025-10-01T03:00:00.000Z");
  });

  it("uses the tenant's calendar day, not the UTC one, to find 'today'", () => {
    // 02:30Z on 1 Oct is still 30 Sep at 23:30 in Mendoza.
    expect(inicioVentanaRecurrentes(new Date("2026-10-01T02:30:00Z"), TZ).toISOString()).toBe("2025-09-30T03:00:00.000Z");
  });
});

describe("mediana / intervaloTipicoDias", () => {
  it("mediana: odd, even and unsorted lists", () => {
    expect(mediana([30])).toBe(30);
    expect(mediana([40, 10, 30])).toBe(30);
    expect(mediana([30, 31])).toBe(30.5);
  });

  it("2 occurrences: the single gap", () => {
    expect(intervaloTipicoDias([100, 128], null)).toBe(28);
  });

  it("2 occurrences with a known duracionTratamientoDias on the latest: that value wins over the gap", () => {
    expect(intervaloTipicoDias([100, 128], 30)).toBe(30);
  });

  it("a null or non-positive duración is ignored", () => {
    expect(intervaloTipicoDias([100, 128], null)).toBe(28);
    expect(intervaloTipicoDias([100, 128], 0)).toBe(28);
  });

  it("3 or more occurrences: the median of the gaps, the duración is NOT used", () => {
    expect(intervaloTipicoDias([100, 130, 160], 90)).toBe(30);
    expect(intervaloTipicoDias([100, 110, 140, 150], 90)).toBe(10); // gaps 10, 30, 10 -> median 10
  });

  it("an even number of gaps rounds the median half up", () => {
    expect(intervaloTipicoDias([100, 130, 161], null)).toBe(31); // gaps 30, 31 -> 30.5
  });
});

describe("estadoRecurrente / esAtrasoDescartable", () => {
  it("ATRASADO before today, ESTA_SEMANA from today to +7 inclusive, MAS_ADELANTE after", () => {
    expect(estadoRecurrente(-1)).toBe("ATRASADO");
    expect(estadoRecurrente(0)).toBe("ESTA_SEMANA");
    expect(estadoRecurrente(DIAS_ESTA_SEMANA)).toBe("ESTA_SEMANA");
    expect(estadoRecurrente(DIAS_ESTA_SEMANA + 1)).toBe("MAS_ADELANTE");
  });

  it("drops an overdue row only when it is MORE than 2x the interval overdue", () => {
    expect(FACTOR_DESCARTE_ATRASADO).toBe(2);
    expect(esAtrasoDescartable(-20, 10)).toBe(false);
    expect(esAtrasoDescartable(-21, 10)).toBe(true);
    expect(esAtrasoDescartable(0, 10)).toBe(false);
    expect(esAtrasoDescartable(5, 10)).toBe(false);
  });
});

describe("calcularRecurrentes -- detection", () => {
  const AHORA = hoyLocal("2026-10-01");

  it("2 recetas with the same fórmula are recurrente; the row carries veces, interval, último pedido and próxima fecha", () => {
    const filas = calcularRecurrentes(dosRecetas("2026-09-10", 28), TZ, AHORA);
    expect(filas).toHaveLength(1);
    expect(filas[0]).toMatchObject({ veces: 2, intervaloDias: 28, diasHastaProxima: 7, estado: "ESTA_SEMANA", quePide: "Cápsula de Melatonina 3 mg" });
    expect(filas[0]!.ultimoPedido).toEqual(ingresoLocal("2026-09-10"));
    // Próxima = 2026-09-10 + 28 days = 2026-10-08, as a calendar day (UTC midnight).
    expect(filas[0]!.proximaFecha.toISOString()).toBe("2026-10-08T00:00:00.000Z");
  });

  it("a fórmula in a single receta is not recurrente", () => {
    expect(calcularRecurrentes([item({ recetaId: "r1", dia: "2026-09-10" })], TZ, AHORA)).toEqual([]);
  });

  it("3+ occurrences use the median gap, whatever the input order", () => {
    const items = [
      item({ recetaId: "r3", dia: "2026-09-20" }),
      item({ recetaId: "r1", dia: "2026-07-01" }),
      item({ recetaId: "r2", dia: "2026-08-20" }), // gaps: 50, 31 -> 40.5 -> 41
    ];
    const [fila] = calcularRecurrentes(items, TZ, AHORA);
    expect(fila).toMatchObject({ veces: 3, intervaloDias: 41 });
    expect(fila!.ultimoPedido).toEqual(ingresoLocal("2026-09-20"));
  });

  it("2 occurrences with a duración on the LATEST item use it as the interval", () => {
    const items = [item({ recetaId: "r-viejo", dia: "2026-08-01", duracion: 10 }), item({ recetaId: "r-nuevo", dia: "2026-09-01", duracion: 45 })];
    expect(calcularRecurrentes(items, TZ, AHORA)[0]).toMatchObject({ intervaloDias: 45 });
    // The duración of the OLDER item is irrelevant.
    const items2 = [item({ recetaId: "r-viejo", dia: "2026-08-01", duracion: 45 }), item({ recetaId: "r-nuevo", dia: "2026-09-01", duracion: null })];
    expect(calcularRecurrentes(items2, TZ, AHORA)[0]).toMatchObject({ intervaloDias: 31 });
  });

  it("the same fórmula twice inside ONE receta counts once", () => {
    const soloUnaReceta = [item({ recetaId: "r1", dia: "2026-09-10" }), item({ recetaId: "r1", dia: "2026-09-10" })];
    expect(calcularRecurrentes(soloUnaReceta, TZ, AHORA)).toEqual([]);

    const conOtraReceta = [...soloUnaReceta, item({ recetaId: "r0", dia: "2026-08-13" })];
    expect(calcularRecurrentes(conOtraReceta, TZ, AHORA)[0]).toMatchObject({ veces: 2, intervaloDias: 28 });
  });

  it("a different cantidad is a different fórmula: no recurrence across them", () => {
    const items = [
      item({ recetaId: "r1", dia: "2026-08-01", componentes: [MELATONINA] }),
      item({ recetaId: "r2", dia: "2026-09-01", componentes: [{ ...MELATONINA, cantidad: "5" }] }),
    ];
    expect(calcularRecurrentes(items, TZ, AHORA)).toEqual([]);
  });

  it("the order of componentes does not matter: the same set across recetas is recurrente", () => {
    const items = [
      item({ recetaId: "r1", dia: "2026-08-01", componentes: [MELATONINA, MAGNESIO] }),
      item({ recetaId: "r2", dia: "2026-09-01", componentes: [MAGNESIO, MELATONINA] }),
    ];
    expect(calcularRecurrentes(items, TZ, AHORA)).toHaveLength(1);
  });

  it("items of an ANULADA receta are excluded (it cannot make a pair recurrente)", () => {
    const items = [item({ recetaId: "r1", dia: "2026-08-01" }), item({ recetaId: "r2", dia: "2026-09-01", estado: "ANULADA" })];
    expect(calcularRecurrentes(items, TZ, AHORA)).toEqual([]);
  });

  it("pacientes dados de baja are excluded", () => {
    const baja = { ...ANA, fechaBaja: new Date("2026-09-15T12:00:00Z") };
    expect(calcularRecurrentes(dosRecetas("2026-09-10", 28, { paciente: baja }), TZ, AHORA)).toEqual([]);
  });

  it("the same fórmula for two different pacientes is NOT a recurrence of either", () => {
    const items = [item({ recetaId: "r1", dia: "2026-08-01", paciente: ANA }), item({ recetaId: "r2", dia: "2026-09-01", paciente: BETO })];
    expect(calcularRecurrentes(items, TZ, AHORA)).toEqual([]);
  });

  it("a paciente with two recurring fórmulas shows two rows", () => {
    const items = [
      ...dosRecetas("2026-09-10", 28, { componentes: [MELATONINA] }).map((i, k) => ({ ...i, receta: { ...i.receta, id: `a${k}` } })),
      ...dosRecetas("2026-09-12", 30, { componentes: [MAGNESIO] }).map((i, k) => ({ ...i, receta: { ...i.receta, id: `b${k}` } })),
    ];
    const filas = calcularRecurrentes(items, TZ, AHORA);
    expect(filas).toHaveLength(2);
    expect(new Set(filas.map((f) => f.paciente.id))).toEqual(new Set(["pac-ana"]));
    expect(new Set(filas.map((f) => f.clave)).size).toBe(2);
  });

  it("uses the descripcion of the latest item when present", () => {
    const items = [item({ recetaId: "r1", dia: "2026-08-01" }), item({ recetaId: "r2", dia: "2026-09-01", descripcion: "Fórmula magistral del Dr. Pérez" })];
    expect(calcularRecurrentes(items, TZ, AHORA)[0]).toMatchObject({ quePide: "Fórmula magistral del Dr. Pérez" });
  });

  it("recetas of the pair ingresadas the same calendar day collapse into ONE occurrence: not recurrente on their own", () => {
    const items = [item({ recetaId: "r1", dia: "2026-09-01" }), item({ recetaId: "r2", dia: "2026-09-01" })];
    expect(calcularRecurrentes(items, TZ, AHORA)).toEqual([]);
  });

  it("same-day duplicates do not distort the median: days 0, 0 and 30 -> 2 occurrences, every 30 days (not ~15)", () => {
    const items = [
      item({ recetaId: "r1", dia: "2026-08-01" }),
      item({ recetaId: "r1-dup", dia: "2026-08-01" }),
      item({ recetaId: "r2", dia: "2026-08-31" }),
    ];
    const [fila] = calcularRecurrentes(items, TZ, AHORA);
    expect(fila).toMatchObject({ veces: 2, intervaloDias: 30 });
  });

  it("the collapse works on the calendar day of the tenant: 21:30 and 23:30 local (00:30Z and 02:30Z next day) are the same day", () => {
    const items = [
      item({ recetaId: "r0", dia: "2026-08-01" }),
      item({ recetaId: "r1", ingreso: new Date("2026-09-02T00:30:00Z") }), // 2026-09-01 21:30 Mendoza
      item({ recetaId: "r2", ingreso: new Date("2026-09-02T02:30:00Z") }), // 2026-09-01 23:30 Mendoza
    ];
    expect(calcularRecurrentes(items, TZ, AHORA)[0]).toMatchObject({ veces: 2, intervaloDias: 31 });
  });

  it("the latest receta of a collapsed day is the one reported (ultimo pedido and que pide)", () => {
    const items = [
      item({ recetaId: "r0", dia: "2026-08-01" }),
      item({ recetaId: "r1", ingreso: new Date("2026-09-01T13:00:00Z"), descripcion: "Mañana" }),
      item({ recetaId: "r2", ingreso: new Date("2026-09-01T20:00:00Z"), descripcion: "Tarde" }),
    ];
    const [fila] = calcularRecurrentes(items, TZ, AHORA);
    expect(fila!.quePide).toBe("Tarde");
    expect(fila!.ultimoPedido).toEqual(new Date("2026-09-01T20:00:00Z"));
  });

  it("calendar days are computed in the tenant zone: 22:30 local on 1 Sep (01:30Z on 2 Sep) is 1 Sep", () => {
    const items = [
      item({ recetaId: "r1", dia: "2026-08-04" }),
      item({ recetaId: "r2", ingreso: new Date("2026-09-02T01:30:00Z") }), // 2026-09-01 22:30 Mendoza
    ];
    const [fila] = calcularRecurrentes(items, TZ, AHORA);
    expect(fila!.intervaloDias).toBe(28); // 4 Aug -> 1 Sep (UTC dates would say 29)
  });
});

describe("calcularRecurrentes -- estado relative to today in the tenant zone", () => {
  /** Last order on `ultimo`, 28-day interval: próxima = ultimo + 28. */
  const conProxima = (hoy: Date, ultimo: string) => calcularRecurrentes(dosRecetas(ultimo, 28), TZ, hoy)[0];

  it("'today' is the farmacia's calendar day, not the UTC one (23:30 local on 30 Sep is 02:30Z on 1 Oct)", () => {
    // Próxima = 2026-09-02 + 28 = 2026-09-30.
    const fila = conProxima(new Date("2026-10-01T02:30:00Z"), "2026-09-02");
    expect(fila!.diasHastaProxima).toBe(0);
    expect(fila!.estado).toBe("ESTA_SEMANA"); // by the UTC date it would be 1 Oct -> ATRASADO
  });

  it("one minute into the next local day the same row is ATRASADO", () => {
    const fila = conProxima(new Date("2026-10-01T03:00:00Z"), "2026-09-02"); // 2026-10-01 00:00 Mendoza
    expect(fila!.diasHastaProxima).toBe(-1);
    expect(fila!.estado).toBe("ATRASADO");
  });

  it("the 7th day ahead is still ESTA_SEMANA, the 8th is MAS_ADELANTE (late evening local time included)", () => {
    // Próxima = 2026-09-10 + 28 = 2026-10-08.
    expect(conProxima(new Date("2026-10-02T02:59:00Z"), "2026-09-10")).toMatchObject({ diasHastaProxima: 7, estado: "ESTA_SEMANA" }); // 1 Oct 23:59 local
    expect(conProxima(new Date("2026-10-01T03:00:00Z"), "2026-09-10")).toMatchObject({ diasHastaProxima: 7, estado: "ESTA_SEMANA" }); // 1 Oct 00:00 local
    expect(conProxima(new Date("2026-09-30T20:00:00Z"), "2026-09-10")).toMatchObject({ diasHastaProxima: 8, estado: "MAS_ADELANTE" }); // 30 Sep 17:00 local
  });

  it("drops an overdue row older than 2x its interval, keeps it at exactly 2x", () => {
    // Interval 28 -> dropped when overdue by > 56 days. Próxima 2026-08-05 (ultimo 2026-07-08).
    expect(conProxima(hoyLocal("2026-09-30"), "2026-07-08")).toMatchObject({ diasHastaProxima: -56, estado: "ATRASADO" });
    expect(conProxima(hoyLocal("2026-10-01"), "2026-07-08")).toBeUndefined();
  });
});

describe("ordering and filtering", () => {
  const AHORA = hoyLocal("2026-10-01");
  const otro = (id: string, apellido: string, nombre: string): PacienteRecurrenteCrudo => ({ ...ANA, id, apellido, nombre });
  const recetasDe = (p: PacienteRecurrenteCrudo, ultimo: string, gap: number) =>
    dosRecetas(ultimo, gap, { paciente: p }).map((i, k) => ({ ...i, receta: { ...i.receta, id: `${p.id}-${k}` } }));

  const items = [
    ...recetasDe(otro("p-zeta", "Zeta", "Zoe"), "2026-09-20", 28), // próxima 18 Oct -> MAS_ADELANTE
    ...recetasDe(otro("p-ana", "Álvarez", "Ana"), "2026-09-03", 28), // próxima 1 Oct -> ESTA_SEMANA (today)
    ...recetasDe(otro("p-bea", "Baez", "Bea"), "2026-09-03", 28), // same próxima, later apellido
    ...recetasDe(otro("p-ces", "Cruz", "Cesar"), "2026-08-20", 28), // próxima 17 Sep -> ATRASADO
  ];

  it("orders by próxima fecha ascending, ties by apellido then nombre", () => {
    const filas = calcularRecurrentes(items, TZ, AHORA);
    expect(filas.map((f) => f.paciente.apellido)).toEqual(["Cruz", "Álvarez", "Baez", "Zeta"]);
  });

  it("is deterministic for any input order", () => {
    const a = calcularRecurrentes(items, TZ, AHORA).map((f) => f.clave);
    const b = calcularRecurrentes([...items].reverse(), TZ, AHORA).map((f) => f.clave);
    expect(b).toEqual(a);
  });

  it("the default window shows ATRASADO + ESTA_SEMANA; 'todos' adds MAS_ADELANTE", () => {
    const filas = calcularRecurrentes(items, TZ, AHORA);
    expect(filtrarPorVentana(filas, "proximos").map((f) => f.estado)).toEqual(["ATRASADO", "ESTA_SEMANA", "ESTA_SEMANA"]);
    expect(filtrarPorVentana(filas, "todos")).toHaveLength(4);
  });

  it("compararRecurrentes breaks a full tie by key", () => {
    const [a, b] = calcularRecurrentes(dosRecetas("2026-09-03", 28).concat(dosRecetas("2026-09-03", 28, { paciente: { ...ANA, id: "pac-ana-2" } })).map((i, k) => ({ ...i, receta: { ...i.receta, id: `r${k}` } })), TZ, AHORA) as [RecurrenteFila, RecurrenteFila];
    expect(compararRecurrentes(a, b)).toBeLessThan(0);
    expect(compararRecurrentes(b, a)).toBeGreaterThan(0);
  });
});

describe("describirQuePide", () => {
  it("forma + drogas with cantidad and unidad, comma-decimal", () => {
    expect(describirQuePide({ descripcion: null, formaFarmaceutica: "CAPSULA", componentes: [{ ...MELATONINA, cantidad: "0.5", unidadSimbolo: "g" }, MAGNESIO] })).toEqual({
      texto: "Cápsula de Melatonina 0,5 g, Magnesio 100 mg",
      textoMensaje: "cápsula de Melatonina 0,5 g, Magnesio 100 mg",
    });
  });

  it("renders each modo de expresión", () => {
    const { texto } = describirQuePide({
      descripcion: null,
      formaFarmaceutica: "POLVO",
      componentes: [{ ...MELATONINA, modoExpresion: "POR_DOSIS" }, { ...MAGNESIO, modoExpresion: "CS", cantidad: null }, EXCIPIENTE],
    });
    expect(texto).toBe("Polvo de Melatonina 3 mg por dosis, Magnesio c.s., Lactosa c.s.p.");
  });

  it("the descripcion wins, verbatim, for both texts", () => {
    expect(describirQuePide({ descripcion: "  Crema de la casa ", formaFarmaceutica: "CREMA", componentes: [MELATONINA] })).toEqual({ texto: "Crema de la casa", textoMensaje: "Crema de la casa" });
  });

  it("caps a long descripcion at 120 characters with an ellipsis (it ends up in the message and the URL)", () => {
    const larga = "x".repeat(300);
    const { texto, textoMensaje } = describirQuePide({ descripcion: larga, formaFarmaceutica: "CREMA", componentes: [] });
    expect(Array.from(texto)).toHaveLength(MAX_DESCRIPCION_CARACTERES);
    expect(texto.endsWith("…")).toBe(true);
    expect(textoMensaje).toBe(texto);
  });

  it("a descripcion of exactly 120 characters is kept whole", () => {
    expect(acotarTexto("y".repeat(120), 120)).toBe("y".repeat(120));
    expect(acotarTexto("y".repeat(121), 120)).toBe(`${"y".repeat(119)}…`);
  });

  it("does not split a surrogate pair when cutting", () => {
    const resultado = acotarTexto("😀".repeat(130), 120);
    expect(Array.from(resultado)).toHaveLength(120);
    expect(resultado.endsWith("😀…")).toBe(true);
  });
});

describe("normalizarTelefonoWhatsappAR", () => {
  it.each([
    // National, no mobile marker (a landline cannot be told apart, so these are accepted).
    ["11 2345 6789", "5491123456789"],
    ["1123456789", "5491123456789"],
    ["351 512 3456", "5493515123456"],
    ["011 4123-4567", "5491141234567"],
    ["0351 412 3456", "5493514123456"],
    // International.
    ["+54 11 4123 4567", "5491141234567"],
    ["54 11 2345 6789", "5491123456789"],
    ["+54 9 11 2345 6789", "5491123456789"],
    ["5491123456789", "5491123456789"],
    ["+5491112345678", "5491112345678"],
    ["0054 9 351 512 3456", "5493515123456"],
    // Mobile prefix 15 after the area code (2, 3 and 4 digit areas).
    ["011 15-1234-5678", "5491112345678"],
    ["(011) 15-2345-6789", "5491123456789"],
    ["0351 15 512 3456", "5493515123456"],
    ["0351 155 123456", "5493515123456"],
    ["(0351) 15-5123456", "5493515123456"],
    ["0 261 15 555 1234", "5492615551234"],
    ["02966 15 123456", "5492966123456"],
    ["+54 9 11 15 2345 6789", "5491123456789"],
    ["+54 11 15 1234 5678", "5491112345678"],
    ["54 351 15 512 3456", "5493515123456"],
    // Mobile marker alone, spacing, extension.
    ["9 11 1234-5678", "5491112345678"],
    ["  011-15-1234-5678  ", "5491112345678"],
    ["351 512 3456 int 15", "5493515123456"],
    ["351 512 3456 interno 204", "5493515123456"],
    ["351 512 3456 ext. 3", "5493515123456"],
    ["351 512 3456 x12", "5493515123456"],
  ])("normalizes %j -> %s", (entrada, esperado) => {
    expect(normalizarTelefonoWhatsappAR(entrada)).toBe(esperado);
  });

  it.each([
    ["1512345678", "mobile prefix but no area code"],
    ["15 2345 6789", "mobile prefix but no area code, spaced"],
    ["4123-4567", "local number without area code (8 digits)"],
    ["351 512 345", "9 digits"],
    ["11 2345 67890", "11 digits"],
    ["3515123456 15", "12 digits without a 15 at a valid position (a bare trailing 15 is not an extension)"],
    ["+34 351 5123456", "foreign number (Spain)"],
    ["+30 21 5123 4567", "foreign number (Greece)"],
    ["+1 305 555 1234", "foreign number (US)"],
    ["0800 222 3333", "toll-free"],
    ["+54 9 41 1234 5678", "area code starting with 4"],
    ["11 1234 5678 / 11 8765 4321", "two numbers in one field are rejected on purpose"],
    ["123", "too short"],
    ["911", "emergency number"],
    ["N/A", "no digits"],
    ["abc", "garbage"],
    ["", "empty"],
    ["   ", "blank"],
  ])("returns null for %j (%s)", (entrada) => {
    expect(normalizarTelefonoWhatsappAR(entrada)).toBeNull();
  });

  it("a + or 00 prefix must be followed by the country code 54", () => {
    expect(normalizarTelefonoWhatsappAR("+54 351 512 3456")).toBe("5493515123456");
    expect(normalizarTelefonoWhatsappAR("00 54 351 512 3456")).toBe("5493515123456");
    expect(normalizarTelefonoWhatsappAR("+351 512 3456")).toBeNull(); // "+351" is Portugal, not area code 351
    expect(normalizarTelefonoWhatsappAR("00 351 512 3456")).toBeNull();
  });

  it("an extension is only dropped when it carries a keyword", () => {
    expect(normalizarTelefonoWhatsappAR("11 2345 6789 int 15")).toBe("5491123456789");
    expect(normalizarTelefonoWhatsappAR("11 2345 6789 15")).toBeNull();
  });

  it("returns null for null and undefined", () => {
    expect(normalizarTelefonoWhatsappAR(null)).toBeNull();
    expect(normalizarTelefonoWhatsappAR(undefined)).toBeNull();
  });

  it("always yields 549 + 10 digits", () => {
    expect(normalizarTelefonoWhatsappAR("011 15-1234-5678")).toMatch(/^549\d{10}$/);
  });
});

describe("evaluarWhatsapp", () => {
  it("available only with consent AND a normalizable phone", () => {
    expect(evaluarWhatsapp(true, "011 15-1234-5678")).toEqual({ disponible: true, telefono: "5491112345678" });
  });

  it("without consent the reason is SIN_CONSENTIMIENTO, even if the phone is missing or invalid", () => {
    expect(evaluarWhatsapp(false, "011 15-1234-5678")).toEqual({ disponible: false, motivo: "SIN_CONSENTIMIENTO" });
    expect(evaluarWhatsapp(false, null)).toEqual({ disponible: false, motivo: "SIN_CONSENTIMIENTO" });
    expect(evaluarWhatsapp(false, "abc")).toEqual({ disponible: false, motivo: "SIN_CONSENTIMIENTO" });
  });

  it("with consent: no phone -> SIN_TELEFONO, unusable phone -> TELEFONO_INVALIDO", () => {
    expect(evaluarWhatsapp(true, null)).toEqual({ disponible: false, motivo: "SIN_TELEFONO" });
    expect(evaluarWhatsapp(true, "   ")).toEqual({ disponible: false, motivo: "SIN_TELEFONO" });
    expect(evaluarWhatsapp(true, "4123-4567")).toEqual({ disponible: false, motivo: "TELEFONO_INVALIDO" });
  });
});

describe("construirMensajeRecordatorio / construirUrlWhatsapp", () => {
  const mensaje = construirMensajeRecordatorio({ nombre: "  Ana  María ", farmacia: "Farmacia San José", formula: "cápsula de Melatonina 3 mg" });

  it("follows the approved wording", () => {
    expect(mensaje).toBe(
      "Hola Ana María, te escribimos de Farmacia San José. Se acerca la fecha de tu preparado de cápsula de Melatonina 3 mg. ¿Querés que lo preparemos? Respondé este mensaje y lo coordinamos.",
    );
  });

  it("does not double the period when the fórmula already ends with one", () => {
    expect(construirMensajeRecordatorio({ nombre: "Ana", farmacia: "F", formula: "lactosa c.s.p." })).toContain("preparado de lactosa c.s.p. ¿Querés");
  });

  it("the wa.me URL carries the digits and the percent-encoded message", () => {
    const url = construirUrlWhatsapp("5491112345678", mensaje);
    expect(url.startsWith("https://wa.me/5491112345678?text=")).toBe(true);
    expect(url).not.toMatch(/\s/);
    expect(url).toContain("%C2%BFQuer%C3%A9s");
    expect(decodeURIComponent(url.slice(url.indexOf("?text=") + 6))).toBe(mensaje);
  });

  it("encodes characters that would break a query string", () => {
    const url = construirUrlWhatsapp("5491112345678", "a&b=c#d?e");
    expect(url).toBe("https://wa.me/5491112345678?text=a%26b%3Dc%23d%3Fe");
  });
});
