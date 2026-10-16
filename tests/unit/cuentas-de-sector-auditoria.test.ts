/**
 * Cuentas de sector (docs/specs/cuentas-de-sector.md): `audit.record` tags a
 * row written on behalf of the empleado verified in the current request with
 * the shared terminal they acted from -- and only those rows.
 */
import { describe, it, expect, vi } from "vitest";
import { record } from "@/shared/audit";
import { ejecutarConOperador } from "@/shared/auth/operador-context";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const SECTOR_ID = "22222222-2222-4222-a222-222222222222";
const EMPLEADO_ID = "33333333-3333-4333-a333-333333333333";
const ENTIDAD_ID = "44444444-4444-4444-a444-444444444444";

function fakeTx() {
  const create = vi.fn(async (args: { data: Record<string, unknown> }) => {
    void args;
    return {};
  });
  return { tx: { registroAuditoria: { create } } as never, create };
}

const fila = (usuarioId: string) => ({ tenantId: TENANT_ID, usuarioId, entidad: "preparacion", entidadId: ENTIDAD_ID, accion: "CONFIRMAR" as const });
const operador = { usuarioId: EMPLEADO_ID, terminal: { usuarioId: SECTOR_ID, usuario: "Laboratorio Fondo", sesionId: "sesion-sector" }, verificacion: "PIN" };

describe("audit.record en una cuenta de sector", () => {
  it("la fila a nombre del empleado verificado lleva contexto.terminal y contexto.verificacion", async () => {
    const { tx, create } = fakeTx();
    await ejecutarConOperador(null, async (solicitud) => {
      solicitud.operador = operador;
      await record(tx, { ...fila(EMPLEADO_ID), contexto: { origen: "entrega" } });
    });
    expect(create.mock.calls[0]![0].data).toMatchObject({
      usuarioId: EMPLEADO_ID,
      contexto: { origen: "entrega", terminal: { usuarioId: SECTOR_ID, usuario: "Laboratorio Fondo", sesionId: "sesion-sector" }, verificacion: "PIN" },
    });
  });

  it("una fila a nombre de la cuenta de sector (acción sin PIN) no se etiqueta", async () => {
    const { tx, create } = fakeTx();
    await ejecutarConOperador(null, async (solicitud) => {
      solicitud.operador = operador;
      await record(tx, fila(SECTOR_ID));
    });
    expect(create.mock.calls[0]![0].data.contexto).toBeUndefined();
  });

  it("fuera de una solicitud con operador no cambia nada", async () => {
    const { tx, create } = fakeTx();
    await record(tx, fila(EMPLEADO_ID));
    expect(create.mock.calls[0]![0].data.contexto).toBeUndefined();
  });
});
