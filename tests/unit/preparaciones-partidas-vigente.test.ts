/**
 * The preparation flow reads a partida's vencimiento VIGENTE, never its original date
 * (openspec/specs/reanalisis-partida/spec.md, R5/R8/R11):
 * - `listPartidasElegiblesDroga` selects `fecha_vencimiento_vigente` as the partida's `fechaVencimiento` (the date
 *   `ordenarParaConsumo` / `proponerReparto` / `estaVencida` evaluate) and flags `reanalizada`.
 * - `cargarPartidasPorDroga` + `partidasDeLinea`: a reanalizada partida (original date past, vigente future) is
 *   offered for consumption; one whose vigente date is past is only listed as vencida (blocked, never in the
 *   consumption order).
 * Mocked repository/tx, no DB -- INV-S10 and v_stock_droga on the vigente date are covered by
 * tests/db/reanalisis-partida.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MENSAJE_VENCIDA_REQUIERE_DT } from "@/modules/stock/domain/vencimiento-partida";
import { proponerReparto } from "@/modules/stock/domain/reparto";
import type { PartidaElegible } from "@/modules/preparaciones/infrastructure/preparacion-repository";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const DROGA_ID = "33333333-3333-4333-a333-333333333333";
const JORNADA = "2026-06-15";

const repo = vi.hoisted(() => ({
  jornadaActualTenant: vi.fn(async () => "2026-06-15"),
  listPartidasElegiblesDroga: vi.fn(async (): Promise<PartidaElegible[]> => []),
}));

vi.mock("@/modules/preparaciones/infrastructure/preparacion-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/preparaciones/infrastructure/preparacion-repository")>()),
  jornadaActualTenant: repo.jornadaActualTenant,
  listPartidasElegiblesDroga: repo.listPartidasElegiblesDroga,
}));

vi.mock("@/modules/stock/application/dias-alerta-vencimiento", () => ({
  diasAlertaVencimientoEnTx: vi.fn(async () => 30),
}));

const { cargarPartidasPorDroga, partidasDeLinea } = await import("@/modules/preparaciones/application/partidas-para-pesar");
const { listPartidasElegiblesDroga } = await vi.importActual<typeof import("@/modules/preparaciones/infrastructure/preparacion-repository")>(
  "@/modules/preparaciones/infrastructure/preparacion-repository",
);

function elegible(id: string, fechaVencimiento: string, reanalizada: boolean): PartidaElegible {
  return {
    id,
    lote: `L-${id}`,
    proveedorNombre: "Prov",
    cantidadDisponible: "50",
    unidadSimbolo: "g",
    fechaVencimiento,
    reanalizada,
    fechaApertura: null,
    potenciaDeclarada: null,
    esDilucion: false,
  };
}

describe("listPartidasElegiblesDroga reads the vencimiento vigente", () => {
  function fakeTx(rows: unknown[]) {
    const calls: { sql: string }[] = [];
    const tx = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        calls.push({ sql: strings.join("?") });
        return rows;
      }),
    };
    return { tx, calls };
  }

  it("selects fecha_vencimiento_vigente as fecha_vencimiento (never the original column) and flags reanalizada", async () => {
    const { tx, calls } = fakeTx([]);
    await listPartidasElegiblesDroga(tx as never, TENANT_ID, DROGA_ID);

    expect(calls).toHaveLength(1);
    const sql = calls[0]!.sql;
    expect(sql).toContain("p.fecha_vencimiento_vigente::text AS fecha_vencimiento");
    expect(sql).toContain("p.fecha_vencimiento_vigente IS DISTINCT FROM p.fecha_vencimiento AS reanalizada");
    expect(sql).not.toContain("p.fecha_vencimiento::text");
  });

  it("maps the vigente date into fechaVencimiento, the date every expiry rule evaluates", async () => {
    const { tx } = fakeTx([
      {
        id: "p-rean",
        lote: "L1",
        proveedor_nombre: "Prov",
        cantidad_disponible: "50",
        unidad_simbolo: "g",
        fecha_vencimiento: "2026-12-31",
        reanalizada: true,
        fecha_apertura: null,
        potencia_declarada: null,
      },
    ]);

    const [partida] = await listPartidasElegiblesDroga(tx as never, TENANT_ID, DROGA_ID);
    expect(partida).toMatchObject({ id: "p-rean", fechaVencimiento: "2026-12-31", reanalizada: true });
  });
});

describe("cargarPartidasPorDroga + partidasDeLinea: availability follows the vigente date", () => {
  const linea = { drogaId: DROGA_ID, cantidadAPesar: "10", esEnraseManual: false };
  // Original lot date 2026-05-01 (past), reanálisis to 2026-12-31: the repository hands over the vigente date.
  const reanalizada = elegible("p-reanalizada", "2026-12-31", true);
  // Never re-analysed, vigente == original == 2026-05-01 (past).
  const vencida = elegible("p-vencida", "2026-05-01", false);

  beforeEach(() => {
    repo.jornadaActualTenant.mockResolvedValue(JORNADA);
    repo.listPartidasElegiblesDroga.mockResolvedValue([vencida, reanalizada]);
  });

  it("puts a reanalizada partida in the consumption order and a past-vigente one only among the vencidas", async () => {
    const cargadas = await cargarPartidasPorDroga({} as never, TENANT_ID, [DROGA_ID]);
    const deDroga = cargadas.porDroga.get(DROGA_ID)!;

    expect(deDroga.consumo.map((p) => p.id)).toEqual(["p-reanalizada"]);
    expect(deDroga.vencidas.map((p) => p.id)).toEqual(["p-vencida"]);
    expect(cargadas).toMatchObject({ jornada: JORNADA, diasAlerta: 30 });
  });

  it("offers the reanalizada partida first, usable; lists the vencida one after it, blocked with the DT notice", async () => {
    const cargadas = await cargarPartidasPorDroga({} as never, TENANT_ID, [DROGA_ID]);
    const pesables = partidasDeLinea(cargadas, linea)!;

    expect(pesables.map((p) => [p.id, p.vencida])).toEqual([
      ["p-reanalizada", false],
      ["p-vencida", true],
    ]);
    expect(pesables[0]!.avisoVencimiento).toBeNull();
    expect(pesables[1]!.avisoVencimiento).toBe(MENSAJE_VENCIDA_REQUIERE_DT);
  });

  it("proponerReparto over the loaded candidates consumes the reanalizada partida and never the vencida one", () => {
    const reparto = proponerReparto([vencida, reanalizada], "60", JORNADA);
    // 50 available on the reanalizada partida; the vencida one's 50 must not fill the gap.
    expect(reparto).toMatchObject({ ok: false, motivo: "STOCK_INSUFICIENTE" });

    const alcanza = proponerReparto([vencida, reanalizada], "10", JORNADA);
    expect(alcanza.ok && alcanza.lineas.map((l) => l.partidaId)).toEqual(["p-reanalizada"]);
  });
});
