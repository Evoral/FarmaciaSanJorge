/**
 * Unit tests for modules/usuarios/domain/estado-usuario.ts -- the pure
 * mirror of migration 0002's `fsj.usuario_validar_transicion_estado`
 * trigger (INV-USR-006). The DB test in tests/db/usuarios-roles.test.ts
 * already proves the TRIGGER itself; this proves the TypeScript mirror
 * agrees with it, transition by transition, without a database.
 */
import { describe, it, expect } from "vitest";
import { esTransicionValida, explicarTransicionInvalida } from "@/modules/usuarios/domain/estado-usuario";
import type { EstadoUsuario } from "@/modules/usuarios/domain/estado-usuario";

const ESTADOS: EstadoUsuario[] = ["PENDIENTE_ACTIVACION", "ACTIVO", "SUSPENDIDO", "BAJA"];

describe("esTransicionValida", () => {
  it("a state transitioning to itself is always valid (mirrors the trigger's NEW.estado = OLD.estado short-circuit)", () => {
    for (const estado of ESTADOS) {
      expect(esTransicionValida(estado, estado)).toBe(true);
    }
  });

  it.each([
    ["PENDIENTE_ACTIVACION", "ACTIVO"],
    ["PENDIENTE_ACTIVACION", "BAJA"],
    ["ACTIVO", "SUSPENDIDO"],
    ["ACTIVO", "PENDIENTE_ACTIVACION"],
    ["ACTIVO", "BAJA"],
    ["SUSPENDIDO", "ACTIVO"],
    ["SUSPENDIDO", "PENDIENTE_ACTIVACION"],
    ["SUSPENDIDO", "BAJA"],
  ] as const)("%s -> %s is valid", (actual, nuevo) => {
    expect(esTransicionValida(actual, nuevo)).toBe(true);
  });

  it.each([
    ["PENDIENTE_ACTIVACION", "SUSPENDIDO"],
    ["BAJA", "ACTIVO"],
    ["BAJA", "SUSPENDIDO"],
    ["BAJA", "PENDIENTE_ACTIVACION"],
  ] as const)("%s -> %s is invalid", (actual, nuevo) => {
    expect(esTransicionValida(actual, nuevo)).toBe(false);
  });

  it("BAJA is terminal: no outgoing transition is valid, even to itself's neighbors", () => {
    for (const nuevo of ESTADOS) {
      if (nuevo === "BAJA") continue;
      expect(esTransicionValida("BAJA", nuevo)).toBe(false);
    }
  });
});

describe("explicarTransicionInvalida", () => {
  it("returns null for a valid transition", () => {
    expect(explicarTransicionInvalida("ACTIVO", "SUSPENDIDO")).toBeNull();
  });

  it("returns a message that mentions the baja is definitive when the current state is BAJA", () => {
    const message = explicarTransicionInvalida("BAJA", "ACTIVO");
    expect(message).not.toBeNull();
    expect(message).toMatch(/baja/i);
  });

  it("returns a non-null message for any other invalid transition", () => {
    expect(explicarTransicionInvalida("PENDIENTE_ACTIVACION", "SUSPENDIDO")).not.toBeNull();
  });
});
