/**
 * Unit tests for `modules/libro/infrastructure/receta-coupling-repository.ts`
 * (D2 REVISED, per-item rule, 2026-09-23): anulling/rectifying ONE asiento
 * only affects that item; the receta moves to ANULADA (motivo referencing
 * the LATEST asiento's numeroCorrelativo) ONLY once EVERY item_receta of
 * the receta is "sin efecto" (own preparación CONFIRMADA and its SISTEMA
 * asiento ANULADO or already rectificado). A receta already in a terminal
 * estado (ENTREGADA/ANULADA) is left untouched, and the caller's operation
 * still proceeds (this function returns `null`, it never throws for that
 * case). Mocks `@/shared/audit` + a hand-built fake `tx`, same "mock the
 * module boundary" convention as tests/unit/libro-anular-asiento.test.ts.
 *
 * The fake tx's `$queryRaw` is called TWICE per non-terminal receta: once
 * for the `FOR UPDATE` lock (return value ignored) and once for the
 * per-item "sin efecto" aggregate (`{ total, sin_efecto }` rows) -- tests
 * queue both via `mockResolvedValueOnce`, in that order.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const auditRecordMock = vi.fn(async (...args: unknown[]) => {
  void args;
  return undefined;
});
vi.mock("@/shared/audit", () => ({
  record: (...args: unknown[]) => auditRecordMock(...args),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const { desvincularRecetaPorAsiento } = await import("@/modules/libro/infrastructure/receta-coupling-repository");

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const PREPARACION_ID = "22222222-2222-4222-a222-222222222222";
const ITEM_RECETA_ID = "33333333-3333-4333-a333-333333333333";
const RECETA_ID = "44444444-4444-4444-a444-444444444444";
const USUARIO_ID = "u-far";

interface FakeTxOptions {
  preparacion?: { itemRecetaId: string } | null;
  item?: { recetaId: string } | null;
  receta?: { id: string; estado: string } | null;
  /** `{ total, sin_efecto }` row returned by the per-item aggregate query, queued AFTER the lock's (ignored) row. */
  agregadoSinEfecto?: { total: number; sin_efecto: number };
}

function makeFakeTx(opts: FakeTxOptions) {
  const preparacionFindUnique = vi.fn(async () => opts.preparacion ?? null);
  const itemRecetaFindUnique = vi.fn(async () => opts.item ?? null);
  const recetaFindUnique = vi.fn(async () => opts.receta ?? null);
  const recetaUpdate = vi.fn(async () => undefined);
  const queryRaw = vi.fn(async (): Promise<unknown[]> => []);
  queryRaw.mockResolvedValueOnce([]); // lock's own row, ignored
  if (opts.agregadoSinEfecto) {
    queryRaw.mockResolvedValueOnce([opts.agregadoSinEfecto]);
  }
  return {
    tx: {
      preparacion: { findUnique: preparacionFindUnique },
      itemReceta: { findUnique: itemRecetaFindUnique },
      receta: { findUnique: recetaFindUnique, update: recetaUpdate },
      $queryRaw: queryRaw,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    preparacionFindUnique,
    itemRecetaFindUnique,
    recetaFindUnique,
    recetaUpdate,
    queryRaw,
  };
}

const baseInput = {
  tenantId: TENANT_ID,
  numeroCorrelativo: "7",
  motivo: "El paciente no retira",
  usuarioId: USUARIO_ID,
};

describe("desvincularRecetaPorAsiento", () => {
  beforeEach(() => {
    auditRecordMock.mockClear();
  });

  it("no preparacionId (null) -> no-op, returns null, touches nothing", async () => {
    const fake = makeFakeTx({});
    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: null });
    expect(result).toBeNull();
    expect(fake.preparacionFindUnique).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("preparacion not found -> null, no receta touched", async () => {
    const fake = makeFakeTx({ preparacion: null });
    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });
    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
  });

  it("item_receta not found (dangling preparacion) -> null, no receta touched", async () => {
    const fake = makeFakeTx({ preparacion: { itemRecetaId: ITEM_RECETA_ID }, item: null });
    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });
    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
  });

  it("D2: receta already ENTREGADA (terminal) -> left UNTOUCHED, returns null, no audit -- the caller's operation still proceeds", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "ENTREGADA" },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
    // Terminal check short-circuits BEFORE the per-item aggregate is even queried.
    expect(fake.queryRaw).toHaveBeenCalledTimes(1);
  });

  it("receta already ANULADA (terminal) -> also left untouched", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "ANULADA" },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
  });

  it("single-item receta, that item now sin efecto (total=1, sin_efecto=1) -> ANULADA with motivo referencing the LATEST asiento", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "EN_PREPARACION" },
      agregadoSinEfecto: { total: 1, sin_efecto: 1 },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, {
      ...baseInput,
      preparacionId: PREPARACION_ID,
      numeroCorrelativo: "42",
      motivo: "El paciente no retira",
    });

    expect(result).toEqual({ recetaId: RECETA_ID, estadoAnterior: "EN_PREPARACION" });
    expect(fake.recetaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RECETA_ID, tenantId: TENANT_ID },
        data: { estado: "ANULADA", motivoAnulacion: "Todos los ítems quedaron sin efecto (último: asiento Nº 42): El paciente no retira" },
      }),
    );
    expect(auditRecordMock).toHaveBeenCalledWith(
      fake.tx,
      expect.objectContaining({
        tenantId: TENANT_ID,
        usuarioId: USUARIO_ID,
        entidad: "receta",
        entidadId: RECETA_ID,
        motivo: "Todos los ítems quedaron sin efecto (último: asiento Nº 42): El paciente no retira",
        valorAnterior: { estado: "EN_PREPARACION" },
        valorNuevo: { estado: "ANULADA" },
      }),
    );
  });

  it("two-item receta, only ONE anulled so far (total=2, sin_efecto=1) -> receta left UNCHANGED", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "EN_PREPARACION" },
      agregadoSinEfecto: { total: 2, sin_efecto: 1 },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
    expect(auditRecordMock).not.toHaveBeenCalled();
  });

  it("two-item receta, the SECOND item is anulled later (total=2, sin_efecto=2) -> receta now ANULADA", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "EN_PREPARACION" },
      agregadoSinEfecto: { total: 2, sin_efecto: 2 },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID, numeroCorrelativo: "99" });

    expect(result).toEqual({ recetaId: RECETA_ID, estadoAnterior: "EN_PREPARACION" });
    expect(fake.recetaUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { estado: "ANULADA", motivoAnulacion: expect.stringContaining("asiento Nº 99") } }),
    );
  });

  it("an item not yet prepared (total=2, sin_efecto=1, the other item is PENDIENTE) -> receta left UNCHANGED", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "PREPARADA" },
      agregadoSinEfecto: { total: 2, sin_efecto: 1 },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    expect(result).toBeNull();
    expect(fake.recetaUpdate).not.toHaveBeenCalled();
  });

  it("ENTREGADA receta -> unchanged, but the operation proceeds (no throw, terminal short-circuit)", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "ENTREGADA" },
    });

    await expect(desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID })).resolves.toBeNull();
  });

  it("a rectificativo counts as sin efecto (total=1, sin_efecto=1 even though the asiento's OWN estado stayed VIGENTE) -> ANULADA", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "PREPARADA" },
      agregadoSinEfecto: { total: 1, sin_efecto: 1 },
    });

    const result = await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    expect(result).toEqual({ recetaId: RECETA_ID, estadoAnterior: "PREPARADA" });
    expect(fake.recetaUpdate).toHaveBeenCalled();
  });

  it("locks the receta row (FOR UPDATE) BEFORE reading it fresh -- M3 discipline", async () => {
    const fake = makeFakeTx({
      preparacion: { itemRecetaId: ITEM_RECETA_ID },
      item: { recetaId: RECETA_ID },
      receta: { id: RECETA_ID, estado: "PENDIENTE_PREPARACION" },
      agregadoSinEfecto: { total: 1, sin_efecto: 0 },
    });

    await desvincularRecetaPorAsiento(fake.tx, { ...baseInput, preparacionId: PREPARACION_ID });

    // The lock is the FIRST $queryRaw call, strictly before the receta is read fresh.
    expect(fake.queryRaw.mock.invocationCallOrder[0]!).toBeLessThan(fake.recetaFindUnique.mock.invocationCallOrder[0]!);
  });
});
