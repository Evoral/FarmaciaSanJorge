/**
 * Behavioral tests for FASE 11's write commands (M14): write ORDER inside
 * the transaction (migration 0040's header comment depends on it),
 * rejection paths (user decision 3, INV-R08-shaped estado gate), and the
 * envío -> confirmar firma atomic path. Mocked repository/tx, no DB --
 * tests/db covers the real SQL/trigger shape (INV-ENT-002).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { DomainError, NotFoundError, ValidationError } from "@/shared/errors";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const withTenantTransactionMock = vi.fn(async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: (...args: [string, (tx: unknown) => unknown]) => withTenantTransactionMock(...args),
}));

vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const RECETA_ID = "22222222-2222-4222-a222-222222222222";
const ENTREGA_ID = "33333333-3333-4333-a333-333333333333";
const USUARIO_ID = "u-1";

function fakeSession(permiso: string): AuthenticatedSession {
  return {
    usuario: { id: USUARIO_ID, email: "u@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT_ID,
    sesionId: "s1",
    permisos: new Set([permiso]) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}

const callOrder: string[] = [];

interface ItemParaEntregaMock {
  id: string;
  estadoAsiento: "PENDIENTE" | "VIGENTE" | "SIN_EFECTO";
}

const lockRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("lock");
  return true;
});
const getRecetaParaEntregaMock = vi.fn();
const getItemsParaEntregaMock = vi.fn(async (...args: unknown[]): Promise<ItemParaEntregaMock[]> => {
  void args;
  return [{ id: "item-1", estadoAsiento: "VIGENTE" }];
});
const actualizarEstadoRecetaMock = vi.fn(async (...args: unknown[]) => {
  const estado = args[3] as string;
  callOrder.push(`estado:${estado}`);
});
const insertEntregaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("insertEntrega");
  return { id: ENTREGA_ID };
});
const getEntregaPorRecetaMock = vi.fn();
const confirmarFirmaYEntregarMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("confirmarFirmaYEntregar");
});

vi.mock("@/modules/entregas/infrastructure/entrega-repository", () => ({
  lockRecetaParaAccion: (...args: unknown[]) => lockRecetaMock(...args),
  getRecetaParaEntrega: (...args: unknown[]) => getRecetaParaEntregaMock(...args),
  getItemsParaEntrega: (...args: unknown[]) => getItemsParaEntregaMock(...args),
  actualizarEstadoReceta: (...args: unknown[]) => actualizarEstadoRecetaMock(...args),
  insertEntrega: (...args: unknown[]) => insertEntregaMock(...args),
  getEntregaPorReceta: (...args: unknown[]) => getEntregaPorRecetaMock(...args),
  confirmarFirmaYEntregar: (...args: unknown[]) => confirmarFirmaYEntregarMock(...args),
}));

const { registrarEntregaCommand } = await import("@/modules/entregas/application/registrar-entrega");
const { confirmarFirmaRecibidaCommand } = await import("@/modules/entregas/application/confirmar-firma-recibida");

function resetMocks() {
  callOrder.length = 0;
  lockRecetaMock.mockClear();
  getRecetaParaEntregaMock.mockReset();
  getItemsParaEntregaMock.mockClear().mockResolvedValue([{ id: "item-1", estadoAsiento: "VIGENTE" }]);
  actualizarEstadoRecetaMock.mockClear();
  insertEntregaMock.mockClear();
  getEntregaPorRecetaMock.mockReset();
  confirmarFirmaYEntregarMock.mockClear();
}

describe("registrarEntrega -- write order and PREPARADA -> LISTA_PARA_RETIRAR -> destino", () => {
  beforeEach(resetMocks);

  it("from PREPARADA + RETIRO_PRESENCIAL: lock -> read -> items -> estado:LISTA_PARA_RETIRAR -> insertEntrega -> estado:ENTREGADA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA" });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "estado:LISTA_PARA_RETIRAR", "insertEntrega", "estado:ENTREGADA"]);
  });

  it("from LISTA_PARA_RETIRAR + ENVIO: no LISTA_PARA_RETIRAR re-transition, insertEntrega before estado:ENVIADA_PEND_FIRMA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "LISTA_PARA_RETIRAR" });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO" },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "insertEntrega", "estado:ENVIADA_PEND_FIRMA"]);
  });

  it("rejects when the receta's estado does not admit registering an entrega", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "EN_PREPARACION" });

    await expect(
      registrarEntregaCommand.execute(
        { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
        { session: fakeSession("entregas.registrar") },
      ),
    ).rejects.toBeInstanceOf(DomainError);

    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("rejects when every item is sin efecto (nothing to deliver, user decision 3)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA" });
    getItemsParaEntregaMock.mockResolvedValue([{ id: "item-1", estadoAsiento: "SIN_EFECTO" }]);

    await expect(
      registrarEntregaCommand.execute(
        { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
        { session: fakeSession("entregas.registrar") },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("404s when the locked target does not exist", async () => {
    lockRecetaMock.mockImplementationOnce(async () => false);

    await expect(
      registrarEntregaCommand.execute(
        { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
        { session: fakeSession("entregas.registrar") },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(getRecetaParaEntregaMock).not.toHaveBeenCalled();
  });
});

describe("confirmarFirmaRecibida -- envío -> confirmar firma atomic path (user decision 1)", () => {
  beforeEach(resetMocks);

  it("confirms when ENVIADA_PEND_FIRMA + an ENVIO entrega row exists and firma_recibida is still false", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: false, firmaRecibidaEn: null });

    await confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.firma.confirmar") });

    expect(confirmarFirmaYEntregarMock).toHaveBeenCalledWith(
      { __fakeTx: true, tenantId: TENANT_ID },
      TENANT_ID,
      { recetaId: RECETA_ID, entregaId: ENTREGA_ID },
    );
  });

  it("rejects when the receta is not ENVIADA_PEND_FIRMA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "LISTA_PARA_RETIRAR" });

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.firma.confirmar") })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(confirmarFirmaYEntregarMock).not.toHaveBeenCalled();
  });

  it("rejects when no matching ENVIO entrega row exists", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue(null);

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.firma.confirmar") })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects when the firma was already confirmed", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: true, firmaRecibidaEn: new Date() });

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.firma.confirmar") })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(confirmarFirmaYEntregarMock).not.toHaveBeenCalled();
  });
});
