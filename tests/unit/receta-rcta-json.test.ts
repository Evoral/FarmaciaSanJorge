/**
 * Unit tests for modules/recetas/domain/receta-rcta-json.ts (docs:
 * importacion-receta-qr spec, R3 -- cases P26-P39): the RCTA decrypter's JSON
 * -> the shared draft (header, paciente, médico, diagnóstico). Every value
 * below is fictitious.
 */
import { describe, it, expect } from "vitest";
import { MENSAJES_LECTURA_QR } from "@/modules/recetas/domain/receta-qr";
import { mapearRecetaRcta } from "@/modules/recetas/domain/receta-rcta-json";
import { esUrlVerificacionDeEmisor } from "@/modules/recetas/domain/receta-pdf-parser";

const HASH = "a1b2c3d4e5f60718".repeat(4);

type Json = Record<string, unknown>;

const PACIENTE: Json = {
  nombre: "XXXXX",
  tipoDoc: "DNI",
  nroDoc: "11222333",
  cuil: "20112223334",
  sexo: "F",
  fechaNacimiento: "1990-05-20T00:00:00",
  cobertura: { numero: "998877/01", financiador: "OBRA SOCIAL DE PRUEBA", plan: "PLAN 1" },
};
const MEDICO: Json = {
  nombre: "Camila",
  apellido: "Ferrero",
  matricula: { tipo: "MP", numero: "4321", provincia: "8" },
  especialidad: "MEDICINA GENERAL",
  lugarAtencion: "Calle Falsa 123 Ciudad Telefono 261 5550000",
  telefono: null,
};
const ITEM: Json = { codDiagnostico: "E660", diagnostico: "Obesidad por exceso de calorias", prescripcion: "Mazindol 1,5 mg\n30 capsulas", notas: "", cantidad: 1 };

/** A complete, fictitious receta as the decrypter returns it; `cambios` override top-level keys. */
const receta = (cambios: Json = {}): Json => ({
  emisor: "RCTA",
  numeroReceta: "1234567890123",
  fechaConfeccion: "03/02/2026",
  fechaEmision: "04/02/2026",
  paciente: PACIENTE,
  medico: MEDICO,
  prescripcion: [ITEM],
  ...cambios,
});
const conPaciente = (c: Json) => receta({ paciente: { ...PACIENTE, ...c } });
const conMedico = (c: Json) => receta({ medico: { ...MEDICO, ...c } });
const conItem = (c: Json) => receta({ prescripcion: [{ ...ITEM, ...c }] });

function leer(json: unknown) {
  const r = mapearRecetaRcta(json, HASH);
  if (!r.ok) throw new Error(`expected ok, got ${r.codigo}`);
  return r;
}
const faltante = (mensaje: string) => ({ codigo: "DATO_FALTANTE", mensaje });

describe("P26: what is not a valid receta", () => {
  it("null, undefined and an empty object mean the hash matched nothing (QR_INVALIDO)", () => {
    for (const vacio of [null, undefined, {}]) {
      expect(mapearRecetaRcta(vacio, HASH)).toEqual({ ok: false, codigo: "QR_INVALIDO", mensaje: MENSAJES_LECTURA_QR.QR_INVALIDO });
    }
  });

  it("a body that fails the schema is an unexpected format, and the message never echoes the data", () => {
    const casos = [receta({ emisor: "OTRO" }), receta({ numeroReceta: undefined }), receta({ numeroReceta: "123" }), receta({ prescripcion: "Mazindol" }), receta({ prescripcion: [] }), "texto", [receta()]];
    for (const caso of casos) {
      expect(mapearRecetaRcta(caso, HASH)).toEqual({ ok: false, codigo: "FORMATO_INESPERADO", mensaje: MENSAJES_LECTURA_QR.FORMATO_INESPERADO });
    }
  });

  it("is tolerant: unknown keys are ignored and absent or null optional blocks do not fail", () => {
    const r = leer({ ...receta({ campoNuevo: { x: 1 } }), paciente: undefined, medico: null });
    expect(r.borrador.nroRecetaEmisor).toBe("1234567890123");
    expect(r.borrador.paciente).toMatchObject({ dni: null, cuil: null, sexo: null, fechaNacimiento: null, nroCredencial: null });
    expect(r.borrador.medico).toMatchObject({ nombre: null, matricula: null, matriculaJurisdiccion: null });
  });
});

describe("P27-P29: identification and dates", () => {
  it("P27: the receta number (string or number) is the emisor's number", () => {
    expect(leer(receta()).borrador).toMatchObject({ emisor: "RCTA", nroRecetaEmisor: "1234567890123" });
    expect(leer(receta({ numeroReceta: 9876543210987 })).borrador.nroRecetaEmisor).toBe("9876543210987");
  });

  it("P28: the verification URL is rebuilt from the hash and passes the issuer check", () => {
    const { urlVerificacion } = leer(receta({ urlVerificacion: "https://evil.example/x" })).borrador;
    expect(urlVerificacion).toBe(`https://verumrp.com.ar/prescripcion/${HASH}`);
    expect(esUrlVerificacionDeEmisor("RCTA", urlVerificacion!)).toBe(true);
  });

  it("P29: fechaConfeccion is 'Creada' and fechaEmision is 'Vigencia desde' (ISO)", () => {
    expect(leer(receta()).borrador).toMatchObject({ fechaPrescripcion: "2026-02-03", fechaValidaDesde: "2026-02-04" });
    expect(leer(receta({ fechaConfeccion: "15/11/2025", fechaEmision: "01/12/2025" })).borrador).toMatchObject({ fechaPrescripcion: "2025-11-15", fechaValidaDesde: "2025-12-01" });
  });

  it("P29: a missing or impossible fechaConfeccion is null with a visible warning", () => {
    for (const fechaConfeccion of [undefined, "31/02/2026", ""]) {
      const r = leer(receta({ fechaConfeccion }));
      expect(r.borrador.fechaPrescripcion).toBeNull();
      expect(r.advertencias).toContainEqual(faltante("No se encontró la fecha de creación de la receta."));
    }
    expect(leer(receta()).advertencias.some((a) => a.mensaje.includes("fecha de creación"))).toBe(false);
  });
});

describe("P30-P33: paciente", () => {
  it("P30: dni, cuil and credencial come from nroDoc, cuil and cobertura.numero; financiador and plan are ignored", () => {
    const { paciente } = leer(receta()).borrador;
    expect(paciente).toMatchObject({ dni: "11222333", cuil: "20112223334", nroCredencial: "998877/01" });
    expect(JSON.stringify(paciente)).not.toContain("OBRA SOCIAL");
    expect(leer(conPaciente({ nroDoc: 44555666, cuil: "27-44555666-1", cobertura: null })).borrador.paciente).toMatchObject({ dni: "44555666", cuil: "27445556661", nroCredencial: null });
    expect(leer(conPaciente({ tipoDoc: "PAS", nroDoc: "AB123456" })).borrador.paciente.dni).toBeNull();
  });

  it("P31: sexo F/M become the words the system stores; anything else is null without failing", () => {
    const sexos = [["F", "Femenino"], ["m", "Masculino"], ["X", null], [null, null]] as const;
    for (const [codigo, esperado] of sexos) expect(leer(conPaciente({ sexo: codigo })).borrador.paciente.sexo).toBe(esperado);
  });

  it("P32: the birth date keeps its day; the 0001-01-01 sentinel, junk and null are null", () => {
    const fechas = [["1992-04-17T00:00:00", "1992-04-17"], ["0001-01-01T00:00:00", null], ["no es fecha", null], ["1992-13-45T00:00:00", null], [null, null]] as const;
    for (const [valor, esperado] of fechas) expect(leer(conPaciente({ fechaNacimiento: valor })).borrador.paciente.fechaNacimiento).toBe(esperado);
  });

  it("P33: the anonymized name is never used, and the preview says the QR has no patient name", () => {
    const r = leer(receta());
    expect(r.borrador.paciente.nombre).toBeNull();
    expect(r.advertencias).toContainEqual(faltante("El QR no incluye el nombre del paciente: escribilo para confirmar la importación."));
    expect(JSON.stringify(r)).not.toContain("XXXXX");
  });
});

describe("P34-P37: médico", () => {
  it("P34: nombre and apellido are used as they come, with no confirmation needed", () => {
    expect(leer(receta()).borrador.medico.nombre).toEqual({ nombreCompleto: "Camila Ferrero", nombre: "Camila", apellido: "Ferrero", requiereConfirmacion: false });
    expect(leer(conMedico({ nombre: " Juan  Pablo ", apellido: "Del Río" })).borrador.medico.nombre).toMatchObject({ nombre: "Juan Pablo", apellido: "Del Río", requiereConfirmacion: false });
  });

  it("P34: a missing name is null with a visible warning", () => {
    for (const cambios of [{ nombre: null }, { apellido: "" }]) {
      const r = leer(conMedico(cambios));
      expect(r.borrador.medico.nombre).toBeNull();
      expect(r.advertencias).toContainEqual(faltante("No se encontró el nombre del médico."));
    }
  });

  it("P35: MP is provincial and MN is nacional; the province code is ignored", () => {
    expect(leer(receta()).borrador.medico).toMatchObject({ matricula: "4321", matriculaJurisdiccion: "PROVINCIAL" });
    expect(leer(conMedico({ matricula: { tipo: "MN", numero: 98765, provincia: "2" } })).borrador.medico).toMatchObject({ matricula: "98765", matriculaJurisdiccion: "NACIONAL" });
  });

  it("P35: another type keeps the number with no jurisdicción and warns; no matrícula warns like the PDF", () => {
    const otro = leer(conMedico({ matricula: { tipo: "XX", numero: "4321" } }));
    expect(otro.borrador.medico).toMatchObject({ matricula: "4321", matriculaJurisdiccion: null });
    expect(otro.advertencias).toContainEqual(faltante("No se reconoció el tipo de matrícula del médico (MP o MN): elegí la jurisdicción."));

    const sin = leer(conMedico({ matricula: null }));
    expect(sin.borrador.medico).toMatchObject({ matricula: null, matriculaJurisdiccion: null });
    expect(sin.advertencias).toContainEqual(faltante("No se encontró la matrícula del médico."));
  });

  it("P36-P37: lugarAtencion '<dirección> Teléfono <número>' is split; without a phone it is all dirección (and the médico's own phone is used)", () => {
    expect(leer(receta()).borrador.medico).toMatchObject({ especialidad: "MEDICINA GENERAL", direccionRegistrada: "Calle Falsa 123 Ciudad", telefono: "261 5550000" });
    expect(leer(conMedico({ lugarAtencion: "Calle Falsa 123 Ciudad" })).borrador.medico).toMatchObject({ direccionRegistrada: "Calle Falsa 123 Ciudad", telefono: null });
    expect(leer(conMedico({ lugarAtencion: "Calle Falsa 123 Ciudad", telefono: "261 4440000" })).borrador.medico.telefono).toBe("261 4440000");
    expect(leer(conMedico({ lugarAtencion: null })).borrador.medico.direccionRegistrada).toBeNull();
  });
});

describe("P38-P39: diagnóstico", () => {
  it("P38: a CIE-10 code without its dot gets it; one that already has it, or has none to add, is kept", () => {
    expect(leer(receta()).borrador).toMatchObject({ diagnosticoCodigo: "E66.0", diagnosticoDescripcion: "Obesidad por exceso de calorias" });
    for (const [crudo, esperado] of [["e66.0", "E66.0"], ["J45", "J45"], ["M545", "M54.5"]] as const) {
      expect(leer(conItem({ codDiagnostico: crudo })).borrador.diagnosticoCodigo).toBe(esperado);
    }
  });

  it("P38: an invalid code is null, the description is kept and a warning says so", () => {
    for (const codDiagnostico of ["XX", "66.0", "E66.0000X"]) {
      const r = leer(conItem({ codDiagnostico }));
      expect(r.borrador).toMatchObject({ diagnosticoCodigo: null, diagnosticoDescripcion: "Obesidad por exceso de calorias" });
      expect(r.advertencias).toContainEqual(faltante("El código de diagnóstico de la receta no tiene formato CIE-10: se conserva solo la descripción."));
    }
  });

  it("P39: the first item's diagnóstico is used when the top level has none; the top-level one wins when both exist", () => {
    expect(leer(receta({ codDiagnostico: "J450", diagnostico: "Asma" })).borrador).toMatchObject({ diagnosticoCodigo: "J45.0", diagnosticoDescripcion: "Asma" });
    const sin = leer(conItem({ codDiagnostico: null, diagnostico: null }));
    expect(sin.borrador).toMatchObject({ diagnosticoCodigo: null, diagnosticoDescripcion: null });
    expect(sin.advertencias.some((a) => a.mensaje.includes("diagnóstico"))).toBe(false);
  });
});
