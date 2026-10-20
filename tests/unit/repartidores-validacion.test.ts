/**
 * Unit tests for modules/repartidores: the pure rules in `domain/repartidor.ts` and the input schemas of the use
 * cases (trim / collapse whitespace, non-empty, max lengths mirroring the migration 0093 CHECKs).
 */
import { describe, it, expect } from "vitest";
import {
  APELLIDO_MAX_LENGTH,
  NOMBRE_MAX_LENGTH,
  TELEFONO_MAX_LENGTH,
  formatearNombreRepartidor,
  formatearRepartidorOpcion,
  normalizarTexto,
} from "@/modules/repartidores/domain/repartidor";
import { crearRepartidorInput } from "@/modules/repartidores/application/crear-repartidor";
import { editarRepartidorInput } from "@/modules/repartidores/application/editar-repartidor";
import { cambiarEstadoRepartidorInput } from "@/modules/repartidores/application/cambiar-estado-repartidor";
import { listRepartidoresInput } from "@/modules/repartidores/application/list-repartidores";
import { buscarRepartidoresInput } from "@/modules/repartidores/application/buscar-repartidores";

const ID = "22222222-2222-4222-a222-222222222222";
const VALIDO = { nombre: "Juan", apellido: "Pérez", telefono: "261 555-0101" };

describe("limits mirror the repartidor_*_check constraints of migration 0093", () => {
  it("are 100 / 100 / 30", () => {
    expect(NOMBRE_MAX_LENGTH).toBe(100);
    expect(APELLIDO_MAX_LENGTH).toBe(100);
    expect(TELEFONO_MAX_LENGTH).toBe(30);
  });
});

describe("normalizarTexto", () => {
  it("trims and collapses internal whitespace", () => {
    expect(normalizarTexto("  Juan   Carlos ")).toBe("Juan Carlos");
    expect(normalizarTexto("\tPérez\n")).toBe("Pérez");
  });
});

describe("crearRepartidorInput", () => {
  it("accepts valid data and normalizes it", () => {
    const parsed = crearRepartidorInput.parse({ nombre: "  Juan   Carlos ", apellido: " Pérez ", telefono: " 261  555-0101 " });
    expect(parsed).toEqual({ nombre: "Juan Carlos", apellido: "Pérez", telefono: "261 555-0101" });
  });

  it.each(["nombre", "apellido", "telefono"] as const)("rejects an empty or blank %s", (campo) => {
    expect(crearRepartidorInput.safeParse({ ...VALIDO, [campo]: "" }).success).toBe(false);
    expect(crearRepartidorInput.safeParse({ ...VALIDO, [campo]: "   " }).success).toBe(false);
  });

  it("rejects a missing field", () => {
    expect(crearRepartidorInput.safeParse({ nombre: "Juan", apellido: "Pérez" }).success).toBe(false);
  });

  it("accepts the maximum lengths and rejects one more character", () => {
    expect(crearRepartidorInput.safeParse({ nombre: "n".repeat(NOMBRE_MAX_LENGTH), apellido: "a".repeat(APELLIDO_MAX_LENGTH), telefono: "1".repeat(TELEFONO_MAX_LENGTH) }).success).toBe(true);
    expect(crearRepartidorInput.safeParse({ ...VALIDO, nombre: "n".repeat(NOMBRE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(crearRepartidorInput.safeParse({ ...VALIDO, apellido: "a".repeat(APELLIDO_MAX_LENGTH + 1) }).success).toBe(false);
    expect(crearRepartidorInput.safeParse({ ...VALIDO, telefono: "1".repeat(TELEFONO_MAX_LENGTH + 1) }).success).toBe(false);
  });

  it("measures the length AFTER normalizing (so it matches what is stored)", () => {
    expect(crearRepartidorInput.safeParse({ ...VALIDO, telefono: `  ${"1".repeat(TELEFONO_MAX_LENGTH)}  ` }).success).toBe(true);
  });

  it("rejects unknown fields (strict)", () => {
    expect(crearRepartidorInput.safeParse({ ...VALIDO, activo: false }).success).toBe(false);
  });
});

describe("editarRepartidorInput", () => {
  it("needs a uuid id and valid data", () => {
    expect(editarRepartidorInput.safeParse({ id: ID, ...VALIDO }).success).toBe(true);
    expect(editarRepartidorInput.safeParse({ id: "no-es-un-uuid", ...VALIDO }).success).toBe(false);
    expect(editarRepartidorInput.safeParse({ ...VALIDO }).success).toBe(false);
    expect(editarRepartidorInput.safeParse({ id: ID, ...VALIDO, telefono: "" }).success).toBe(false);
  });
});

describe("cambiarEstadoRepartidorInput", () => {
  it("needs a uuid id and a boolean activo", () => {
    expect(cambiarEstadoRepartidorInput.safeParse({ id: ID, activo: false }).success).toBe(true);
    expect(cambiarEstadoRepartidorInput.safeParse({ id: ID, activo: "true" }).success).toBe(false);
    expect(cambiarEstadoRepartidorInput.safeParse({ id: ID }).success).toBe(false);
  });
});

describe("listRepartidoresInput", () => {
  it("defaults to page 1 of 20 and keeps every filter optional", () => {
    expect(listRepartidoresInput.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listRepartidoresInput.parse({ search: "  perez ", activo: true })).toMatchObject({ search: "perez", activo: true });
  });

  it("bounds the page size", () => {
    expect(listRepartidoresInput.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(listRepartidoresInput.safeParse({ page: 0 }).success).toBe(false);
  });
});

describe("buscarRepartidoresInput", () => {
  it("defaults to an empty text and ONLY active repartidores", () => {
    expect(buscarRepartidoresInput.parse({})).toEqual({ texto: "", soloActivos: true });
  });

  it("lets the caller opt in to inactive ones (the hoja de envíos of a repartidor already deactivated)", () => {
    expect(buscarRepartidoresInput.parse({ texto: " perez ", soloActivos: false })).toEqual({ texto: "perez", soloActivos: false });
  });

  it("rejects an oversized text", () => {
    expect(buscarRepartidoresInput.safeParse({ texto: "x".repeat(101) }).success).toBe(false);
  });
});

describe("formatearRepartidorOpcion", () => {
  const base = { id: ID, nombre: "Juan", apellido: "Pérez", telefono: "261 555-0101", activo: true };

  it("shows 'Apellido, Nombre · teléfono'", () => {
    expect(formatearNombreRepartidor(base)).toBe("Pérez, Juan");
    expect(formatearRepartidorOpcion(base)).toBe("Pérez, Juan · 261 555-0101");
  });

  it("suffixes ' (inactivo)' for an inactive repartidor", () => {
    expect(formatearRepartidorOpcion({ ...base, activo: false })).toBe("Pérez, Juan · 261 555-0101 (inactivo)");
  });
});
