/**
 * Data model for the global help guide (CA2, design.md "Guide data model").
 *
 * The guide lives in the codebase and is identical across all tenants.
 * Authorization is evaluated at runtime per tenant session (CA3).
 */
import type { Permiso } from "@/shared/auth/authorize";

export type DetalleEntradaGuia = {
  readonly tema: string;
  readonly texto: string;
};

export type EntradaGuia = {
  readonly id: string; // stable slug, e.g. "recetas.cargar" — the model's enum value
  readonly titulo: string; // "Cargar receta"
  readonly permisos: readonly Permiso[]; // ALL required (CA3); typed: a renamed permiso breaks the build
  readonly ruta: string; // static app route, no dynamic segments: "/recetas/nuevo"
  readonly pasos: string; // one short line: where + which button. Always sent
  readonly detalles?: readonly DetalleEntradaGuia[]; // sent only for the entry in focus
  readonly spec?: string; // openspec/specs/<spec> it was derived from
};

export type GuiaAyuda = readonly EntradaGuia[];
