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

/**
 * Shaped exactly like a real decrypter response (FICTITIOUS values): the item's own
 * code/diagnóstico are blank, the diagnóstico lives at the top level, the item text
 * is one multi-line string whose first line is the practice's address, and the
 * response carries many extra top-level keys the import ignores.
 */
const RECETA_REAL: Json = {
  emisor: "RCTA",
  numeroReceta: "1234567890123",
  fechaConfeccion: "03/02/2026",
  fechaEmision: "04/02/2026",
  codDiagnostico: "E660",
  diagnostico: "Obesidad debida a exceso de calorias",
  paciente: PACIENTE,
  medico: MEDICO,
  prescripcion: [
    {
      codDiagnostico: "",
      diagnostico: null,
      prescripcion: "Calle Falsa 123 Ciudad \n\nMazindol 1,5 mg \n\n30 cápsulas \nMedia dosis cada 12 horas\nTratamiento por 30 días",
      notas: "",
      codPractica: null,
      cantidad: 1,
      nroCUIR: null,
    },
  ],
  practica: null,
  horario: null,
  diasAtencion: null,
  datosContacto: null,
  nombreConsultorio: null,
  direccionConsultorio: null,
  email: "consultorio@example.com",
  imprimirDiagnostico: "S",
  informacionAdicional: null,
  nroPrestador: null,
  clienteAppId: 156,
  hash: "Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op",
};

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
    const casos = [receta({ emisor: "OTRO" }), receta({ numeroReceta: undefined }), receta({ numeroReceta: "123" }), receta({ numeroReceta: 1234567890123 }), receta({ prescripcion: "Mazindol" }), receta({ prescripcion: [] }), "texto", [receta()]];
    for (const caso of casos) {
      expect(mapearRecetaRcta(caso, HASH)).toEqual({ ok: false, codigo: "FORMATO_INESPERADO", mensaje: MENSAJES_LECTURA_QR.FORMATO_INESPERADO });
    }
  });

  it("does not cap the number of prescripcion elements (the adapter's body cap bounds the size)", () => {
    expect(leer(receta({ prescripcion: Array.from({ length: 21 }, () => ITEM) })).borrador.nroRecetaEmisor).toBe("1234567890123");
  });

  it("is tolerant: unknown keys are ignored and absent or null optional blocks do not fail", () => {
    const r = leer({ ...receta({ campoNuevo: { x: 1 } }), paciente: undefined, medico: null });
    expect(r.borrador.nroRecetaEmisor).toBe("1234567890123");
    expect(r.borrador.paciente).toMatchObject({ dni: null, cuil: null, sexo: null, fechaNacimiento: null, nroCredencial: null });
    expect(r.borrador.medico).toMatchObject({ nombre: null, matricula: null, matriculaJurisdiccion: null });
  });
});

describe("regression: a response shaped like the real one", () => {
  it("maps header, paciente, médico and the top-level diagnóstico; the extra keys and the blank item diagnóstico are harmless", () => {
    const r = leer(RECETA_REAL);
    expect(r.borrador).toMatchObject({
      emisor: "RCTA",
      nroRecetaEmisor: "1234567890123",
      urlVerificacion: `https://verumrp.com.ar/prescripcion/${HASH}`,
      fechaPrescripcion: "2026-02-03",
      diagnosticoCodigo: "E66.0",
      diagnosticoDescripcion: "Obesidad debida a exceso de calorias",
    });
    expect(r.borrador.paciente).toMatchObject({ dni: "11222333", sexo: "Femenino" });
    expect(r.borrador.medico).toMatchObject({ matricula: "4321", matriculaJurisdiccion: "PROVINCIAL" });
    expect(r.advertencias.some((a) => a.mensaje.includes("CIE-10"))).toBe(false);
  });
});

describe("P27-P29: identification and dates", () => {
  it("P27: the receta number is the emisor's number, and only a string (a JSON number would lose leading zeros)", () => {
    expect(leer(receta()).borrador).toMatchObject({ emisor: "RCTA", nroRecetaEmisor: "1234567890123" });
    expect(leer(receta({ numeroReceta: "0012345678901" })).borrador.nroRecetaEmisor).toBe("0012345678901");
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

const conTexto = (prescripcion: string | null, cambios: Json = {}) => receta({ prescripcion: [{ ...ITEM, prescripcion, ...cambios }] });
const clasePorCodigo = (r: ReturnType<typeof leer>, codigo: string) => r.advertencias.filter((a) => a.codigo === codigo);

describe("P40-P42: items", () => {
  it("P42: the real-shaped receta gives one item (component, presentación, fracción + posología, duración) and the PDF's consistency warning", () => {
    const r = leer(RECETA_REAL);
    expect(r.borrador.items).toEqual([
      {
        formaFarmaceutica: "CAPSULA",
        cantidadUnidades: 30,
        fraccionDosisPorUnidad: "0.5",
        posologia: "Media dosis cada 12 horas",
        duracionTratamientoDias: 30,
        componentes: [{ drogaTexto: "Mazindol", cantidad: "1.5", unidadTexto: "mg", modoExpresion: "POR_DOSIS", esPrincipioActivo: true }],
      },
    ]);
    expect(clasePorCodigo(r, "UNIDADES_VS_DURACION").map((a) => a.mensaje)).toEqual(["Las unidades alcanzan para 15 días; la receta indica 30."]);
    expect(clasePorCodigo(r, "RENGLON_NO_RECONOCIDO")).toEqual([]);
  });

  it("P42: lines may be separated by \\r\\n and blank lines, and keep their order", () => {
    const r = leer(conTexto("Ibuprofeno 400 mg\r\n\r\n 20 comprimidos \r\nCada 8 horas\r\n"));
    expect(r.borrador.items[0]).toMatchObject({ cantidadUnidades: 20, formaFarmaceutica: "COMPRIMIDO", posologia: "Cada 8 horas" });
    expect(r.borrador.items[0]!.componentes).toHaveLength(1);
  });

  it("P40: every prescripcion element is its own item, parsed independently", () => {
    const r = leer(receta({
      prescripcion: [
        { ...ITEM, prescripcion: "Mazindol 1,5 mg\n30 cápsulas\nMedia dosis cada 12 horas\nTratamiento por 15 días" },
        { ...ITEM, prescripcion: "Ibuprofeno 400 mg\n20 comprimidos\nCada 8 horas\nTratamiento por 7 días" },
      ],
    }));
    expect(r.borrador.items.map((i) => [i.componentes[0]!.drogaTexto, i.cantidadUnidades, i.fraccionDosisPorUnidad, i.duracionTratamientoDias])).toEqual([
      ["Mazindol", 30, "0.5", 15],
      ["Ibuprofeno", 20, "1", 7],
    ]);
    expect(clasePorCodigo(r, "MAS_DE_UN_ITEM")).toEqual([]);
    expect(clasePorCodigo(r, "UNIDADES_VS_DURACION")).toHaveLength(1);
  });

  it("an element with no usable text keeps an empty item and says what is missing", () => {
    for (const texto of [null, "", " \n "]) {
      const r = leer(conTexto(texto));
      expect(r.borrador.items).toHaveLength(1);
      expect(r.borrador.items[0]!.componentes).toEqual([]);
      expect(r.advertencias).toContainEqual(faltante("No se encontraron componentes con su dosis."));
      expect(r.advertencias).toContainEqual(faltante("No se encontró la cantidad de unidades (por ejemplo, «30 comprimidos»)."));
    }
    expect(leer(RECETA_REAL).advertencias.some((a) => a.mensaje.includes("componentes con su dosis"))).toBe(false);
  });

  it("a non-string item text is an unexpected format", () => {
    expect(mapearRecetaRcta(conTexto(["Mazindol"] as unknown as string), HASH)).toMatchObject({ ok: false, codigo: "FORMATO_INESPERADO" });
  });
});

describe("P43: source data the import does not store", () => {
  it("non-empty notas, codPractica and nroCUIR each warn that they are not imported, and the notas text is shown", () => {
    const r = leer(conTexto("Mazindol 1,5 mg\n30 cápsulas", { notas: "Tomar con agua", codPractica: "420101", nroCUIR: "CUIR-1" }));
    const avisos = clasePorCodigo(r, "DATO_NO_IMPORTADO").map((a) => a.mensaje);
    expect(avisos).toHaveLength(3);
    expect(avisos.some((m) => m.includes("Tomar con agua"))).toBe(true);
    expect(JSON.stringify(r.borrador)).not.toMatch(/Tomar con agua|420101|CUIR-1/);
  });

  it("a non-null top-level practica warns once; blank or null values do not warn", () => {
    expect(clasePorCodigo(leer(receta({ practica: { descripcion: "x" } })), "DATO_NO_IMPORTADO")).toHaveLength(1);
    expect(clasePorCodigo(leer(conTexto("Mazindol 1,5 mg", { notas: "  ", codPractica: "", nroCUIR: null })), "DATO_NO_IMPORTADO")).toEqual([]);
    expect(clasePorCodigo(leer(RECETA_REAL), "DATO_NO_IMPORTADO")).toEqual([]);
  });

  it("cantidad is ignored, as in the PDF flow", () => {
    expect(leer(conTexto("Mazindol 1,5 mg\n30 cápsulas", { cantidad: 7 })).borrador.items[0]!.cantidadUnidades).toBe(30);
  });
});

describe("P44-P45: lines that are not part of the prescription", () => {
  it("P44: unclassifiable lines BEFORE the first component are informational notices with the literal text and never stored", () => {
    const r = leer(RECETA_REAL);
    expect(clasePorCodigo(r, "RENGLON_INFORMATIVO")).toEqual([
      { codigo: "RENGLON_INFORMATIVO", mensaje: "Texto al inicio de la receta (informativo, no se guarda): «Calle Falsa 123 Ciudad»", texto: "Calle Falsa 123 Ciudad" },
    ]);
    expect(JSON.stringify(r.borrador.items)).not.toContain("Calle Falsa");
  });

  it("P44: several leading lines each get a notice; the same text on a second item is not repeated", () => {
    const r = leer(receta({
      prescripcion: [
        { ...ITEM, prescripcion: "Consultorio Norte\nCalle Falsa 123\nMazindol 1,5 mg" },
        { ...ITEM, prescripcion: "Calle Falsa 123\nIbuprofeno 400 mg" },
      ],
    }));
    expect(clasePorCodigo(r, "RENGLON_INFORMATIVO").map((a) => a.texto)).toEqual(["Consultorio Norte", "Calle Falsa 123"]);
    expect(r.borrador.items.map((i) => i.componentes[0]!.drogaTexto)).toEqual(["Mazindol", "Ibuprofeno"]);
  });

  it("P45: an unclassifiable line AFTER the first component keeps the existing RENGLON_NO_RECONOCIDO warning", () => {
    const r = leer(conTexto("Calle Falsa 123\nMazindol 1,5 mg\nlinea rara del medico\n30 cápsulas"));
    expect(clasePorCodigo(r, "RENGLON_NO_RECONOCIDO").map((a) => a.texto)).toEqual(["linea rara del medico"]);
    expect(clasePorCodigo(r, "RENGLON_INFORMATIVO").map((a) => a.texto)).toEqual(["Calle Falsa 123"]);
  });

  it("without any component nothing is 'leading': every unclassifiable line is a normal warning", () => {
    const r = leer(conTexto("texto suelto\n30 cápsulas"));
    expect(clasePorCodigo(r, "RENGLON_INFORMATIVO")).toEqual([]);
    expect(clasePorCodigo(r, "RENGLON_NO_RECONOCIDO").map((a) => a.texto)).toEqual(["texto suelto"]);
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

  it("P39: the diagnóstico is merged PER FIELD: a blank top-level code falls back to the item's code, keeping the top-level description", () => {
    const r = leer(receta({ codDiagnostico: "", diagnostico: "Obesidad (texto de arriba)", prescripcion: [{ ...ITEM, codDiagnostico: "E660", diagnostico: "texto del item" }] }));
    expect(r.borrador).toMatchObject({ diagnosticoCodigo: "E66.0", diagnosticoDescripcion: "Obesidad (texto de arriba)" });
    // And the other way round: top-level code, description only on the item.
    const inverso = leer(receta({ codDiagnostico: "J450", diagnostico: null, prescripcion: [{ ...ITEM, codDiagnostico: "E660", diagnostico: "Asma del item" }] }));
    expect(inverso.borrador).toMatchObject({ diagnosticoCodigo: "J45.0", diagnosticoDescripcion: "Asma del item" });
  });

  it("P38: the description is capped at the confirm input's 2000 characters", () => {
    const largo = "a".repeat(2500);
    expect(leer(receta({ diagnostico: largo })).borrador.diagnosticoDescripcion).toBe("a".repeat(2000));
    expect(leer(receta({ diagnostico: "corto" })).borrador.diagnosticoDescripcion).toBe("corto");
  });

  it("P39: the first item's diagnóstico is used when the top level has none; the top-level one wins when both exist", () => {
    expect(leer(receta({ codDiagnostico: "J450", diagnostico: "Asma" })).borrador).toMatchObject({ diagnosticoCodigo: "J45.0", diagnosticoDescripcion: "Asma" });
    const sin = leer(conItem({ codDiagnostico: null, diagnostico: null }));
    expect(sin.borrador).toMatchObject({ diagnosticoCodigo: null, diagnosticoDescripcion: null });
    expect(sin.advertencias.some((a) => a.mensaje.includes("diagnóstico"))).toBe(false);
  });
});
