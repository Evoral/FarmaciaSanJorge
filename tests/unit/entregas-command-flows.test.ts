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
import {
  MENSAJE_ENVIO_SIN_DOMICILIO,
  MENSAJE_DOMICILIO_YA_CARGADO,
  MENSAJE_RETIRO_CON_DOMICILIO,
  MENSAJE_REPARTIDOR_INACTIVO,
  MENSAJE_REPARTIDOR_NO_ENCONTRADO,
} from "@/modules/entregas/domain/entrega";

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
const REPARTIDOR_ID = "44444444-4444-4444-a444-444444444444";
const OTRO_REPARTIDOR_ID = "55555555-5555-4555-a555-555555555555";
const DOMICILIO = "Calle Falsa 123, Ciudad Ejemplo";
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
const marcarRecetaPagadaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("pago");
});
const actualizarDomicilioRecetaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("domicilio");
});
const getEntregaPorRecetaMock = vi.fn();
const getRepartidorParaAsignarMock = vi.fn();
const cambiarRepartidorDeEntregaMock = vi.fn(async (...args: unknown[]) => {
  void args;
  callOrder.push("cambiarRepartidor");
});
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
  marcarRecetaPagada: (...args: unknown[]) => marcarRecetaPagadaMock(...args),
  actualizarDomicilioReceta: (...args: unknown[]) => actualizarDomicilioRecetaMock(...args),
  getEntregaPorReceta: (...args: unknown[]) => getEntregaPorRecetaMock(...args),
  getRepartidorParaAsignar: (...args: unknown[]) => getRepartidorParaAsignarMock(...args),
  cambiarRepartidorDeEntrega: (...args: unknown[]) => cambiarRepartidorDeEntregaMock(...args),
  confirmarFirmaYEntregar: (...args: unknown[]) => confirmarFirmaYEntregarMock(...args),
}));

const { registrarEntregaCommand } = await import("@/modules/entregas/application/registrar-entrega");
const { confirmarFirmaRecibidaCommand } = await import("@/modules/entregas/application/confirmar-firma-recibida");
const { cambiarRepartidorCommand, MENSAJE_MISMO_REPARTIDOR } = await import("@/modules/entregas/application/cambiar-repartidor");
const { record: auditRecordMock } = await import("@/shared/audit");

function resetMocks() {
  callOrder.length = 0;
  lockRecetaMock.mockClear();
  getRecetaParaEntregaMock.mockReset();
  getItemsParaEntregaMock.mockClear().mockResolvedValue([{ id: "item-1", estadoAsiento: "VIGENTE" }]);
  actualizarEstadoRecetaMock.mockClear();
  insertEntregaMock.mockClear();
  marcarRecetaPagadaMock.mockClear();
  actualizarDomicilioRecetaMock.mockClear();
  getEntregaPorRecetaMock.mockReset();
  getRepartidorParaAsignarMock.mockReset().mockResolvedValue({ id: REPARTIDOR_ID, activo: true });
  cambiarRepartidorDeEntregaMock.mockClear();
  confirmarFirmaYEntregarMock.mockClear();
  vi.mocked(auditRecordMock).mockClear();
}

describe("registrarEntrega -- write order and PREPARADA -> destino", () => {
  beforeEach(resetMocks);

  it("from PREPARADA + RETIRO_PRESENCIAL (already paid): lock -> read -> items -> insertEntrega -> estado:ENTREGADA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "insertEntrega", "estado:ENTREGADA"]);
  });

  it("from PREPARADA + ENVIO: an unpaid receta can be sent -- insertEntrega before estado:ENVIADA_PEND_FIRMA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: false, domicilioPaciente: DOMICILIO });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "insertEntrega", "estado:ENVIADA_PEND_FIRMA"]);
    expect(insertEntregaMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ modalidad: "ENVIO", repartidorId: REPARTIDOR_ID }));
  });

  it("ENVIO audits the repartidor in the CAMBIAR_ESTADO valorNuevo; RETIRO_PRESENCIAL carries none", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: DOMICILIO });

    // The command's own audit record is written by the pipeline (mocked `record`): its valorNuevo is what we assert.
    const envio = await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID },
      { session: fakeSession("entregas.registrar") },
    );
    expect(envio.estado).toBe("ENVIADA_PEND_FIRMA");
    expect(vi.mocked(auditRecordMock)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ valorNuevo: expect.objectContaining({ modalidad: "ENVIO", repartidorId: REPARTIDOR_ID }) }),
    );

    vi.mocked(auditRecordMock).mockClear();
    await registrarEntregaCommand.execute({ recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" }, { session: fakeSession("entregas.registrar") });
    const valorNuevo = vi.mocked(auditRecordMock).mock.calls[0]?.[1].valorNuevo as Record<string, unknown>;
    expect(valorNuevo).not.toHaveProperty("repartidorId");
  });

  it("ENVIO without repartidor: rejected by the input schema on the repartidor field, nothing read or written (E1)", async () => {
    const rejected = registrarEntregaCommand.execute({ recetaId: RECETA_ID, modalidad: "ENVIO" }, { session: fakeSession("entregas.registrar") });
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toMatchObject({ fields: ["repartidorId"] });
    expect(lockRecetaMock).not.toHaveBeenCalled();
    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("RETIRO_PRESENCIAL with a repartidor: rejected by the input schema on the repartidor field (E2)", async () => {
    const rejected = registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL", pagada: true, repartidorId: REPARTIDOR_ID },
      { session: fakeSession("entregas.registrar") },
    );
    await expect(rejected).rejects.toBeInstanceOf(ValidationError);
    await expect(rejected).rejects.toMatchObject({ fields: ["repartidorId"] });
    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("ENVIO of a receta without domicilio (null or blank) and none typed: rejected on the domicilio field before any write (E4)", async () => {
    for (const domicilioPaciente of [null, "   "]) {
      getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente });
      for (const domicilio of [undefined, "", "   "]) {
        const rejected = registrarEntregaCommand.execute(
          { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID, domicilio },
          { session: fakeSession("entregas.registrar") },
        );
        await expect(rejected).rejects.toThrow(MENSAJE_ENVIO_SIN_DOMICILIO);
        await expect(rejected).rejects.toMatchObject({ fields: ["domicilio"] });
      }
    }
    expect(actualizarDomicilioRecetaMock).not.toHaveBeenCalled();
    expect(insertEntregaMock).not.toHaveBeenCalled();
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
  });

  it("ENVIO of a receta without domicilio + one typed: saved as the receta's domicilio de entrega (trimmed) and audited as MODIFICAR, BEFORE the entrega is inserted (E4)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: false, domicilioPaciente: null, domicilioEntrega: null });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID, domicilio: "  " + DOMICILIO + "  " },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "domicilio", "insertEntrega", "estado:ENVIADA_PEND_FIRMA"]);
    expect(actualizarDomicilioRecetaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_ID, DOMICILIO);
    expect(vi.mocked(auditRecordMock)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entidad: "receta",
        entidadId: RECETA_ID,
        accion: "MODIFICAR",
        valorAnterior: { domicilioEntrega: null },
        valorNuevo: { domicilioEntrega: DOMICILIO },
      }),
    );
  });

  it("ENVIO of a receta with blank-only domicilios saves the typed one as its domicilio de entrega, recording the old value", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: "   ", domicilioEntrega: "  " });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID, domicilio: DOMICILIO },
      { session: fakeSession("entregas.registrar") },
    );

    expect(actualizarDomicilioRecetaMock).toHaveBeenCalledWith(expect.anything(), TENANT_ID, RECETA_ID, DOMICILIO);
    expect(vi.mocked(auditRecordMock)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ entidad: "receta", valorAnterior: { domicilioEntrega: "  " } }),
    );
  });

  it("ENVIO of a receta that already has a domicilio: nothing is written to the receta and no receta audit row (E4)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: DOMICILIO });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "insertEntrega", "estado:ENVIADA_PEND_FIRMA"]);
    expect(actualizarDomicilioRecetaMock).not.toHaveBeenCalled();
    expect(vi.mocked(auditRecordMock).mock.calls.some(([, entrada]) => entrada.entidad === "receta")).toBe(false);
  });

  it("ENVIO sending a domicilio while the receta already has one: rejected on the domicilio field, receta untouched (E4)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: DOMICILIO });

    const rejected = registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID, domicilio: "Otra calle 9" },
      { session: fakeSession("entregas.registrar") },
    );
    await expect(rejected).rejects.toThrow(MENSAJE_DOMICILIO_YA_CARGADO);
    await expect(rejected).rejects.toMatchObject({ fields: ["domicilio"] });
    expect(actualizarDomicilioRecetaMock).not.toHaveBeenCalled();
    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("RETIRO_PRESENCIAL with a domicilio: rejected by the input schema on the domicilio field (E4)", async () => {
    const rejected = registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL", pagada: true, domicilio: DOMICILIO },
      { session: fakeSession("entregas.registrar") },
    );
    await expect(rejected).rejects.toThrow(MENSAJE_RETIRO_CON_DOMICILIO);
    await expect(rejected).rejects.toMatchObject({ fields: ["domicilio"] });
    expect(lockRecetaMock).not.toHaveBeenCalled();
  });

  it("a domicilio longer than the receta form's limit is rejected by the input schema (same rule as domicilioPaciente)", async () => {
    const rejected = registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID, domicilio: "x".repeat(301) },
      { session: fakeSession("entregas.registrar") },
    );
    await expect(rejected).rejects.toMatchObject({ fields: ["domicilio"] });
    expect(lockRecetaMock).not.toHaveBeenCalled();
  });

  it("ENVIO with an inactive repartidor: rejected before any write (E3)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: DOMICILIO });
    getRepartidorParaAsignarMock.mockResolvedValue({ id: REPARTIDOR_ID, activo: false });

    await expect(
      registrarEntregaCommand.execute({ recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID }, { session: fakeSession("entregas.registrar") }),
    ).rejects.toThrow(MENSAJE_REPARTIDOR_INACTIVO);
    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("ENVIO with a repartidor that does not exist in the tenant: rejected before any write (E3)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: true, domicilioPaciente: DOMICILIO });
    getRepartidorParaAsignarMock.mockResolvedValue(null);

    await expect(
      registrarEntregaCommand.execute({ recetaId: RECETA_ID, modalidad: "ENVIO", repartidorId: REPARTIDOR_ID }, { session: fakeSession("entregas.registrar") }),
    ).rejects.toThrow(MENSAJE_REPARTIDOR_NO_ENCONTRADO);
    expect(insertEntregaMock).not.toHaveBeenCalled();
  });

  it("RETIRO_PRESENCIAL marking the payment: the payment is written BEFORE estado:ENTREGADA (INV-R14)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: false });

    await registrarEntregaCommand.execute(
      { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL", pagada: true },
      { session: fakeSession("entregas.registrar") },
    );

    expect(callOrder).toEqual(["lock", "insertEntrega", "pago", "estado:ENTREGADA"]);
  });

  it("RETIRO_PRESENCIAL of an unpaid receta without marking the payment: rejected before any write", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA", pagada: false });

    await expect(
      registrarEntregaCommand.execute(
        { recetaId: RECETA_ID, modalidad: "RETIRO_PRESENCIAL" },
        { session: fakeSession("entregas.registrar") },
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(insertEntregaMock).not.toHaveBeenCalled();
    expect(actualizarEstadoRecetaMock).not.toHaveBeenCalled();
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

describe("cambiarRepartidor -- only while the envío waits for its firma (E5)", () => {
  beforeEach(resetMocks);

  const envioConRepartidor = {
    id: ENTREGA_ID,
    modalidad: "ENVIO",
    entregadaEn: new Date(),
    firmaRecibida: false,
    firmaRecibidaEn: null,
    repartidorId: REPARTIDOR_ID,
  };
  const session = () => fakeSession("entregas.registrar");

  it("changes the repartidor of an ENVIADA_PEND_FIRMA envío and audits the before/after on the entrega", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA", pagada: false, domicilioPaciente: DOMICILIO });
    getEntregaPorRecetaMock.mockResolvedValue(envioConRepartidor);
    getRepartidorParaAsignarMock.mockResolvedValue({ id: OTRO_REPARTIDOR_ID, activo: true });

    await cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() });

    expect(callOrder).toEqual(["lock", "cambiarRepartidor"]);
    expect(cambiarRepartidorDeEntregaMock).toHaveBeenCalledWith({ __fakeTx: true, tenantId: TENANT_ID }, TENANT_ID, ENTREGA_ID, OTRO_REPARTIDOR_ID);
    expect(vi.mocked(auditRecordMock)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entidad: "entrega",
        entidadId: ENTREGA_ID,
        accion: "MODIFICAR",
        valorAnterior: { repartidorId: REPARTIDOR_ID },
        valorNuevo: { repartidorId: OTRO_REPARTIDOR_ID },
      }),
    );
  });

  it("assigns a repartidor to an envío registered before the feature (none yet, E7)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA", pagada: false });
    getEntregaPorRecetaMock.mockResolvedValue({ ...envioConRepartidor, repartidorId: null });

    await cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: REPARTIDOR_ID }, { session: session() });

    expect(cambiarRepartidorDeEntregaMock).toHaveBeenCalledOnce();
  });

  it.each(["PREPARADA", "ENTREGADA", "ANULADA"])("rejects when the receta is %s (not waiting for its firma)", async (estado) => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado });

    await expect(
      cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() }),
    ).rejects.toBeInstanceOf(DomainError);
    expect(cambiarRepartidorDeEntregaMock).not.toHaveBeenCalled();
  });

  it("rejects when the entrega is not an ENVIO", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue({ ...envioConRepartidor, modalidad: "RETIRO_PRESENCIAL", repartidorId: null });

    await expect(
      cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(cambiarRepartidorDeEntregaMock).not.toHaveBeenCalled();
  });

  it("rejects the repartidor the envío already has (nothing to change, no audit row)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue(envioConRepartidor);

    await expect(cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: REPARTIDOR_ID }, { session: session() })).rejects.toThrow(
      MENSAJE_MISMO_REPARTIDOR,
    );
    expect(cambiarRepartidorDeEntregaMock).not.toHaveBeenCalled();
    expect(vi.mocked(auditRecordMock)).not.toHaveBeenCalled();
  });

  it("rejects an inactive repartidor (E3) and one that does not exist in the tenant", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue(envioConRepartidor);

    getRepartidorParaAsignarMock.mockResolvedValue({ id: OTRO_REPARTIDOR_ID, activo: false });
    await expect(
      cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() }),
    ).rejects.toThrow(MENSAJE_REPARTIDOR_INACTIVO);

    getRepartidorParaAsignarMock.mockResolvedValue(null);
    await expect(
      cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() }),
    ).rejects.toThrow(MENSAJE_REPARTIDOR_NO_ENCONTRADO);
    expect(cambiarRepartidorDeEntregaMock).not.toHaveBeenCalled();
  });

  it("requires a repartidor: removing it is not an option (E5)", async () => {
    await expect(cambiarRepartidorCommand.execute({ recetaId: RECETA_ID } as never, { session: session() })).rejects.toBeInstanceOf(ValidationError);
    expect(lockRecetaMock).not.toHaveBeenCalled();
  });

  it("404s when the locked target does not exist", async () => {
    lockRecetaMock.mockImplementationOnce(async () => false);

    await expect(
      cambiarRepartidorCommand.execute({ recetaId: RECETA_ID, repartidorId: OTRO_REPARTIDOR_ID }, { session: session() }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(getRecetaParaEntregaMock).not.toHaveBeenCalled();
  });
});

describe("confirmarFirmaRecibida -- envío -> confirmar firma atomic path (user decision 1)", () => {
  beforeEach(resetMocks);

  it("confirms when ENVIADA_PEND_FIRMA + an ENVIO entrega row exists and firma_recibida is still false", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA", pagada: true });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: false, firmaRecibidaEn: null });

    await confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.registrar") });

    expect(confirmarFirmaYEntregarMock).toHaveBeenCalledWith(
      { __fakeTx: true, tenantId: TENANT_ID },
      TENANT_ID,
      { recetaId: RECETA_ID, entregaId: ENTREGA_ID },
    );
  });

  it("an unpaid envío: marking the payment writes it BEFORE confirmarFirmaYEntregar (INV-R14)", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA", pagada: false });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: false, firmaRecibidaEn: null });

    await confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID, pagada: true }, { session: fakeSession("entregas.registrar") });

    expect(callOrder).toEqual(["lock", "pago", "confirmarFirmaYEntregar"]);
  });

  it("an unpaid envío without marking the payment: rejected, nothing written", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA", pagada: false });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: false, firmaRecibidaEn: null });

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.registrar") })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(marcarRecetaPagadaMock).not.toHaveBeenCalled();
    expect(confirmarFirmaYEntregarMock).not.toHaveBeenCalled();
  });

  it("rejects when the receta is not ENVIADA_PEND_FIRMA", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "PREPARADA" });

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.registrar") })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(confirmarFirmaYEntregarMock).not.toHaveBeenCalled();
  });

  it("rejects when no matching ENVIO entrega row exists", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue(null);

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.registrar") })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("rejects when the firma was already confirmed", async () => {
    getRecetaParaEntregaMock.mockResolvedValue({ id: RECETA_ID, estado: "ENVIADA_PEND_FIRMA" });
    getEntregaPorRecetaMock.mockResolvedValue({ id: ENTREGA_ID, modalidad: "ENVIO", entregadaEn: new Date(), firmaRecibida: true, firmaRecibidaEn: new Date() });

    await expect(confirmarFirmaRecibidaCommand.execute({ recetaId: RECETA_ID }, { session: fakeSession("entregas.registrar") })).rejects.toBeInstanceOf(
      DomainError,
    );
    expect(confirmarFirmaYEntregarMock).not.toHaveBeenCalled();
  });
});
