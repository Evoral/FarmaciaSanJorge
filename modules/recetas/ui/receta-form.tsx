"use client";

/**
 * Crear/editar receta (FASE 6 points 6.1/6.3). A sectioned form that holds
 * one or more ítems, each with one or more componentes -- dynamic rows are
 * plain array state (add/remove buttons). The componentes of an item have
 * no order (migration 0065), and whether one is a principio activo is not
 * asked: the server derives it from the droga's clase (migration 0063).
 * Every row control has a `<label>` and every add/remove control is a real
 * `<button>` (native keyboard operation: Enter/Space activate, Tab moves
 * focus -- no custom mouse-only affordances).
 *
 * V1-V9 (minus V5) are re-validated client-side before submit for instant
 * feedback, mirroring domain/receta.ts EXACTLY -- but the submit still goes
 * through the real command (crearReceta/editarReceta), which re-validates
 * server-side and is the actual source of truth.
 *
 * Submits go through `shared/ui/use-form-submit.ts` (after the client-side
 * checks pass), so a server error keeps every field and row as entered
 * (React 19 would otherwise reset the `<form action>`); the error's
 * `fields` are marked invalid (`shared/ui/field-errors.ts`). A successful
 * submit navigates to the receta, so there is nothing to reset.
 *
 * `importar` mode (docs/specs/importacion-receta-pdf.md): the same form,
 * prefilled from a read PDF's preview (./nueva-receta.tsx). The paciente/
 * médico pickers are replaced by "Nuevo"/"Existente" panels (with
 * nombre/apellido to confirm when the name split was a guess), drogas the
 * catalog did not match are picked per componente with an optional
 * "recordar esta equivalencia", and the submit goes to `recetas.importar`,
 * which re-derives and re-validates everything server-side.
 *
 * `editar` mode keeps the saved ítems (`inicial`) to tell what is unsaved
 * (the draft as `itemsJson` serializes it vs. the same serialization of the
 * saved ítems, overall and per saved ítem id) and offers "Deshacer cambios"
 * while there is something to undo. Embedded in the /preparaciones toma
 * workspace, `encabezadoFijo` hides paciente/médico and the receta's data
 * (the workspace shows them read-only; they are still submitted unchanged
 * as hidden inputs) and `onBorradorChange` publishes the draft, so the
 * page can preview each changed ítem's ficha técnica before it is saved.
 */
import { useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, Plus, RotateCcw, Save, Trash2, TriangleAlert } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { crearRecetaAction, editarRecetaAction, importarRecetaAction } from "./actions";
import { IDLE_STATE } from "./action-state";
import type { RecetaActionState } from "./action-state";
import { PacientePicker } from "./paciente-picker";
import { MedicoPicker } from "./medico-picker";
import { DrogaPicker } from "./droga-picker";
import { PresupuestoPanel } from "./presupuesto-panel";
import { AdvertenciasImportacion, PanelPersona, ResumenImportacion } from "./importacion-paneles";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import { JURISDICCIONES_MATRICULA, JURISDICCION_MATRICULA_LABELS } from "@/modules/medicos/domain/medico";
import type { JurisdiccionMatricula } from "@/modules/medicos/domain/medico";
import { FORMAS_FARMACEUTICAS, MAX_DOMICILIO_PACIENTE, MODOS_EXPRESION, ORIGEN_RECETA_LABELS, esFormaCapsular, fechaPrescripcionMinima, validarItemsReceta } from "../domain/receta";
import { FORMA_FARMACEUTICA_LABELS, MODO_EXPRESION_LABELS } from "@/shared/labels/enum-labels";
import type { FormaFarmaceutica, ModoExpresion, OrigenReceta } from "../domain/receta";
import type { UnidadOpcion } from "../infrastructure/receta-repository";
import { jornadaDe } from "@/shared/time/jornada";
import { DateInput } from "@/shared/ui/date-input";
import { errorFieldsOf } from "@/shared/ui/form-parts";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { useFormSubmit } from "@/shared/ui/use-form-submit";

interface ComponenteState {
  id?: string;
  drogaId: string;
  /** Canonical name. */
  drogaNombre: string;
  /** The synonym the droga was picked by (stored, migration 0069): the picker shows it, with `drogaNombre` as a hint. */
  drogaAliasId?: string | null;
  sinonimo?: string | null;
  cantidad: string;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
  /** `importar` mode: the drug name as printed on the receta. */
  drogaTexto?: string;
  /** `importar` mode: the catalog had no match -- the user picks it and may remember the equivalence. */
  sinMatch?: boolean;
  recordar?: boolean;
}

interface ItemState {
  id?: string;
  descripcion: string;
  formaFarmaceutica: FormaFarmaceutica;
  cantidadUnidades: string;
  fraccionDosisPorUnidad: string;
  cantidadTotal: string;
  unidadTotalId: string;
  observaciones: string;
  posologia: string;
  duracionTratamientoDias: string;
  componentes: ComponenteState[];
}

function nuevoComponente(): ComponenteState {
  return { drogaId: "", drogaNombre: "", cantidad: "", unidadMedidaId: "", modoExpresion: "TOTAL" };
}

function nuevoItem(): ItemState {
  return {
    descripcion: "",
    formaFarmaceutica: "CREMA",
    cantidadUnidades: "1",
    fraccionDosisPorUnidad: "1",
    cantidadTotal: "",
    unidadTotalId: "",
    observaciones: "",
    posologia: "",
    duracionTratamientoDias: "",
    componentes: [nuevoComponente()],
  };
}

/** `sinGuardar`: a warning icon next to the label -- the edits on screen are not confirmed yet. */
/** `sinCambios`: nothing to save yet -- the button stays disabled (grey) until the draft differs from what is stored. */
function SubmitButton({ label, pending, sinGuardar = false, compacto = false, sinCambios = false }: { label: string; pending: boolean; sinGuardar?: boolean; compacto?: boolean; sinCambios?: boolean }) {
  return (
    <button type="submit" disabled={pending || sinCambios} title={sinCambios ? "No hay cambios para guardar." : undefined} className={compacto ? "btn btn-primary" : "btn btn-primary w-full"}>
      {pending ? <span className="spinner border-white/40 border-t-white" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {pending ? "Guardando…" : label}
      {!pending && sinGuardar ? (
        <>
          <TriangleAlert className="size-4 text-amber-300" aria-hidden />
          <span className="sr-only">(cambios sin guardar)</span>
        </>
      ) : null}
    </button>
  );
}

/** A titled block of the form. */
/** How one dose is split across capsules/tablets; the value is `fraccionDosisPorUnidad`. */
const FRACCIONES_DOSIS = [
  { valor: "1", etiqueta: "Dosis entera" },
  { valor: "0.5", etiqueta: "Media dosis (1/2)" },
  { valor: "0.333333", etiqueta: "Un tercio de dosis (1/3)" },
  { valor: "0.25", etiqueta: "Un cuarto de dosis (1/4)" },
] as const;

/** Maps a stored fraction ("0.50", "1.0000") to its option value, so an edited receta preselects the right one. */
function opcionFraccion(valor: string): string {
  return FRACCIONES_DOSIS.find((f) => Number(f.valor) === Number(valor))?.valor ?? valor;
}

/** Switching forma drops the fields it does not use: the fraction outside capsular forms, the c.s.p. total inside them. */
function cambioDeForma(formaFarmaceutica: FormaFarmaceutica): Partial<ItemState> {
  return esFormaCapsular(formaFarmaceutica) ? { formaFarmaceutica, cantidadTotal: "", unidadTotalId: "" } : { formaFarmaceutica, fraccionDosisPorUnidad: "1" };
}

function FormSection({ title, description, children, id }: { title: string; description?: string; children: ReactNode; id: string }) {
  return (
    <section aria-labelledby={id} className="panel">
      <div className="panel-header">
        <h2 id={id}>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** One ítem as the form submits it (`itemsJson`): trimmed strings, `null` for what was left empty. */
function itemParaEnvio(it: ItemState) {
  return {
    id: it.id,
    descripcion: it.descripcion.trim().length > 0 ? it.descripcion.trim() : null,
    formaFarmaceutica: it.formaFarmaceutica,
    cantidadUnidades: Number.parseInt(it.cantidadUnidades, 10),
    fraccionDosisPorUnidad: it.fraccionDosisPorUnidad.trim() || "1",
    cantidadTotal: it.cantidadTotal.trim().length > 0 ? it.cantidadTotal.trim() : null,
    unidadTotalId: it.unidadTotalId.trim().length > 0 ? it.unidadTotalId.trim() : null,
    observaciones: it.observaciones.trim().length > 0 ? it.observaciones.trim() : null,
    posologia: it.posologia.trim().length > 0 ? it.posologia.trim() : null,
    duracionTratamientoDias: it.duracionTratamientoDias.trim().length > 0 ? Number(it.duracionTratamientoDias.trim()) : null,
    componentes: it.componentes.map((c) => ({
      drogaId: c.drogaId,
      drogaAliasId: c.drogaAliasId ?? null,
      cantidad: c.cantidad.trim().length > 0 ? c.cantidad.trim() : null,
      unidadMedidaId: c.unidadMedidaId,
      modoExpresion: c.modoExpresion,
    })),
  };
}

/** An ítem of the draft as it would be submitted (`id` only for an ítem already saved). */
export type ItemRecetaBorrador = ReturnType<typeof itemParaEnvio>;

/** `editar` mode: the draft's ítems against the saved ones (`onBorradorChange`). */
export interface BorradorReceta {
  items: ItemRecetaBorrador[];
  /** The ítems differ from the saved ones (any change, including added, removed or reordered ítems). */
  sinGuardar: boolean;
  /** Ids of the saved ítems whose draft differs from what is saved, removed ones included. */
  itemsModificados: string[];
}

/** Compares the draft with the saved ítems, both serialized as `itemsJson` is. */
function compararBorrador(itemsJson: string, guardadosJson: string): BorradorReceta {
  const items = JSON.parse(itemsJson) as ItemRecetaBorrador[];
  const guardados = JSON.parse(guardadosJson) as ItemRecetaBorrador[];
  const borradorPorId = new Map(items.flatMap((item) => (item.id ? [[item.id, JSON.stringify(item)] as const] : [])));
  return {
    items,
    sinGuardar: itemsJson !== guardadosJson,
    itemsModificados: guardados.flatMap((guardado) => (guardado.id && borradorPorId.get(guardado.id) !== JSON.stringify(guardado) ? [guardado.id] : [])),
  };
}

/** `2026-09-01` -> `01/09/2026` for the summary (empty stays empty). */
function fechaVisible(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

export interface RecetaFormInicial {
  pacienteId: string;
  pacienteLabel: string;
  medicoId: string;
  medicoLabel: string;
  fechaPrescripcion: string;
  origen: OrigenReceta;
  diagnosticoCodigo: string;
  diagnosticoDescripcion: string;
  domicilioPaciente: string;
  items: ItemState[];
}

export interface RecetaFormProps {
  mode: "crear" | "editar" | "importar";
  unidades: UnidadOpcion[];
  disabled: boolean;
  recetaId?: string;
  inicial?: RecetaFormInicial;
  /** `importar` mode only. */
  vistaPrevia?: VistaPreviaImportacion;
  /** `cotizaciones.calcular`: show the live presupuesto (crear/importar only -- docs/specs/presupuesto-receta.md). */
  puedePresupuestar?: boolean;
  /** `editar` mode only: where to come back after saving when the form is embedded in another screen (an internal /preparaciones path, re-validated by the action -- domain/avisos-generacion.ts#retornoDeEdicion). */
  volverA?: string;
  /** `editar` mode only: paciente, médico and the receta's data are shown read-only by the embedding screen -- not rendered here, submitted unchanged. */
  encabezadoFijo?: boolean;
  /** `editar` mode only: called with the draft whenever its ítems change (and once on mount). */
  onBorradorChange?: (borrador: BorradorReceta) => void;
}

/** The receta form's starting state for an imported PDF: the draft's data plus the catalog matches. */
function itemsDesdeVistaPrevia(vista: VistaPreviaImportacion): ItemState[] {
  return vista.borrador.items.map((item, itemIdx) => ({
    descripcion: "",
    formaFarmaceutica: item.formaFarmaceutica ?? "COMPRIMIDO",
    cantidadUnidades: item.cantidadUnidades !== null ? String(item.cantidadUnidades) : "",
    fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
    cantidadTotal: "",
    unidadTotalId: "",
    observaciones: "",
    posologia: item.posologia ?? "",
    duracionTratamientoDias: item.duracionTratamientoDias !== null ? String(item.duracionTratamientoDias) : "",
    componentes: item.componentes.map((c, compIdx) => {
      const match = vista.componentes[itemIdx]?.[compIdx];
      return {
        drogaId: match?.drogaId ?? "",
        drogaNombre: match?.drogaNombre ?? "",
        drogaAliasId: match?.drogaAliasId ?? null,
        sinonimo: match?.sinonimo ?? null,
        cantidad: c.cantidad,
        unidadMedidaId: match?.unidadMedidaId ?? "",
        modoExpresion: c.modoExpresion,
        drogaTexto: c.drogaTexto,
        sinMatch: !match?.drogaId,
        recordar: false,
      };
    }),
  }));
}

/** `undefined` instead of `null`: the paciente/médico schemas take optional strings, and JSON drops `undefined`. */
function opcional(valor: string | null | undefined): string | undefined {
  return valor ?? undefined;
}

export function RecetaForm({ mode, unidades, disabled, recetaId, inicial, vistaPrevia, puedePresupuestar = false, volverA, encabezadoFijo = false, onBorradorChange }: RecetaFormProps) {
  const importacion = mode === "importar" ? (vistaPrevia ?? null) : null;
  const action = mode === "crear" ? crearRecetaAction : mode === "editar" ? editarRecetaAction : importarRecetaAction;
  const [state, formAction, isPending] = useActionState(action, IDLE_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  const [pacienteId, setPacienteId] = useState(inicial?.pacienteId ?? "");
  const [pacienteLabel, setPacienteLabel] = useState(inicial?.pacienteLabel ?? "");
  const [medicoId, setMedicoId] = useState(inicial?.medicoId ?? "");
  const [medicoLabel, setMedicoLabel] = useState(inicial?.medicoLabel ?? "");
  const borrador = importacion?.borrador ?? null;
  const [fechaPrescripcion, setFechaPrescripcion] = useState(borrador?.fechaPrescripcion ?? inicial?.fechaPrescripcion ?? "");
  // `crear` mode: a receta whose "válida desde" differs from its prescription date (its month of validity counts from it).
  const [conValidaDesde, setConValidaDesde] = useState(false);
  const [fechaValidaDesde, setFechaValidaDesde] = useState("");
  const fechaValidaDesdeId = useId();
  const [diagnosticoCodigo, setDiagnosticoCodigo] = useState(borrador?.diagnosticoCodigo ?? inicial?.diagnosticoCodigo ?? "");
  const [diagnosticoDescripcion, setDiagnosticoDescripcion] = useState(borrador?.diagnosticoDescripcion ?? inicial?.diagnosticoDescripcion ?? "");
  // Stored on the receta, not on the paciente (migration 0070); the PDF import prefills it.
  const [domicilioPaciente, setDomicilioPaciente] = useState(borrador?.domicilioPaciente ?? inicial?.domicilioPaciente ?? "");
  // `crear` / `importar` modes: the receta is created already paid (migration 0071). An edit never changes the payment (the receta detail does).
  const [pagada, setPagada] = useState(false);
  // Manual alta is always PRESENCIAL; an edit keeps the receta's own origen (domain/receta.ts's validarOrigenCargaManual);
  // an import is DIGITAL_PDF.
  const origen: OrigenReceta = importacion ? "DIGITAL_PDF" : (inicial?.origen ?? "PRESENCIAL");
  const [items, setItems] = useState<ItemState[]>(() => (importacion ? itemsDesdeVistaPrevia(importacion) : (inicial?.items ?? [nuevoItem()])));
  // `importar` mode: the people to create (only used when the preview found no existing one).
  const [pacienteNuevo, setPacienteNuevo] = useState(() => ({
    nombre: borrador?.paciente.nombre?.nombre ?? "",
    apellido: borrador?.paciente.nombre?.apellido ?? "",
    confirmado: !(borrador?.paciente.nombre?.requiereConfirmacion ?? false),
  }));
  const [medicoNuevo, setMedicoNuevo] = useState(() => ({
    nombre: borrador?.medico.nombre?.nombre ?? "",
    apellido: borrador?.medico.nombre?.apellido ?? "",
    confirmado: !(borrador?.medico.nombre?.requiereConfirmacion ?? false),
    matricula: borrador?.medico.matricula ?? "",
    matriculaJurisdiccion: (borrador?.medico.matriculaJurisdiccion ?? "PROVINCIAL") as JurisdiccionMatricula,
  }));
  const [clientError, setClientError] = useState<string | null>(null);
  // "Deshacer cambios" also hides the server error it answered (a new submit brings its own state).
  const [errorDescartado, setErrorDescartado] = useState<RecetaActionState | null>(null);
  const encabezadoOculto = mode === "editar" && encabezadoFijo;

  const fechaId = useId();
  const personaIdBase = useId();
  const diagnosticoCodigoId = useId();
  const diagnosticoDescripcionId = useId();
  const domicilioPacienteId = useId();

  useEffect(() => {
    if (state.status === "success" && state.id) {
      // Created -> the list with its success banner; edited -> the receta. Notices are codes only (domain/avisos-generacion.ts).
      router.push(state.redirigirA ?? `/recetas/${state.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useFieldErrors(formRef, errorFieldsOf(state));

  // `editar` mode: what is unsaved. The ítems as they would be submitted vs. the saved ones, same serialization.
  const itemsJson = JSON.stringify(items.map(itemParaEnvio));
  const guardadosJson = useMemo(() => (mode === "editar" && inicial ? JSON.stringify(inicial.items.map(itemParaEnvio)) : null), [mode, inicial]);
  const itemsSinGuardar = guardadosJson !== null && itemsJson !== guardadosJson;
  const encabezadoSinGuardar =
    guardadosJson !== null &&
    !!inicial &&
    (pacienteId !== inicial.pacienteId || medicoId !== inicial.medicoId || fechaPrescripcion !== inicial.fechaPrescripcion || diagnosticoCodigo !== inicial.diagnosticoCodigo || diagnosticoDescripcion !== inicial.diagnosticoDescripcion || domicilioPaciente !== inicial.domicilioPaciente);

  // The embedding screen's callback may change identity on every render: only the draft's changes publish it.
  const onBorradorChangeRef = useRef(onBorradorChange);
  useEffect(() => {
    onBorradorChangeRef.current = onBorradorChange;
  });
  useEffect(() => {
    if (guardadosJson !== null) onBorradorChangeRef.current?.(compararBorrador(itemsJson, guardadosJson));
  }, [itemsJson, guardadosJson]);

  function actualizarItem(idx: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function actualizarComponente(itemIdx: number, compIdx: number, patch: Partial<ComponenteState>) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, componentes: it.componentes.map((c, j) => (j === compIdx ? { ...c, ...patch } : c)) } : it)));
  }

  function agregarItem() {
    setItems((prev) => [...prev, nuevoItem()]);
  }

  function quitarItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function agregarComponente(itemIdx: number) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, componentes: [...it.componentes, nuevoComponente()] } : it)));
  }

  function quitarComponente(itemIdx: number, compIdx: number) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, componentes: it.componentes.filter((_, j) => j !== compIdx) } : it)));
  }

  function itemsParaEnvio() {
    return items.map(itemParaEnvio);
  }

  /** `editar` mode: back to the saved receta (the form's own state; nothing is submitted). */
  function restablecer() {
    if (!inicial) return;
    setItems(inicial.items);
    setPacienteId(inicial.pacienteId);
    setPacienteLabel(inicial.pacienteLabel);
    setMedicoId(inicial.medicoId);
    setMedicoLabel(inicial.medicoLabel);
    setFechaPrescripcion(inicial.fechaPrescripcion);
    setDiagnosticoCodigo(inicial.diagnosticoCodigo);
    setDiagnosticoDescripcion(inicial.diagnosticoDescripcion);
    setDomicilioPaciente(inicial.domicilioPaciente);
    setClientError(null);
    setErrorDescartado(state);
  }

  /** `recetas.importar`'s input (application/importar-receta.ts) -- the server re-matches and re-validates all of it. */
  function payloadImportacion() {
    if (!importacion) return null;
    const { paciente, medico } = importacion;
    const b = importacion.borrador;
    return {
      emisor: b.emisor,
      fuente: importacion.fuente,
      nroRecetaEmisor: b.nroRecetaEmisor,
      urlVerificacion: b.urlVerificacion,
      fechaPrescripcion,
      fechaValidaDesde: b.fechaValidaDesde,
      diagnosticoCodigo,
      diagnosticoDescripcion,
      domicilioPaciente,
      pagada,
      paciente: {
        existenteId: paciente.existente?.id ?? null,
        datos: {
          nombre: paciente.existente ? paciente.existente.nombre : pacienteNuevo.nombre,
          apellido: paciente.existente ? paciente.existente.apellido : pacienteNuevo.apellido,
          dni: opcional(b.paciente.dni),
          cuil: opcional(b.paciente.cuil),
          sexo: opcional(b.paciente.sexo),
          fechaNacimiento: opcional(b.paciente.fechaNacimiento),
          nroCredencial: opcional(b.paciente.nroCredencial),
        },
      },
      medico: {
        existenteId: medico.existente?.id ?? null,
        datos: {
          nombre: medico.existente ? medico.existente.nombre : medicoNuevo.nombre,
          apellido: medico.existente ? medico.existente.apellido : medicoNuevo.apellido,
          matricula: medico.existente ? medico.existente.matricula : medicoNuevo.matricula,
          matriculaJurisdiccion: medicoNuevo.matriculaJurisdiccion,
          especialidad: opcional(b.medico.especialidad),
          telefono: opcional(b.medico.telefono),
          direccionRegistrada: opcional(b.medico.direccionRegistrada),
        },
      },
      items: itemsParaEnvio(),
      // `componentes`: where the text was printed -- the server loads them with the remembered synonym.
      equivalencias: items.flatMap((it, itemIdx) =>
        it.componentes.flatMap((c, compIdx) =>
          c.sinMatch && c.recordar && c.drogaId && c.drogaTexto ? [{ aliasTexto: c.drogaTexto, drogaId: c.drogaId, componentes: [{ item: itemIdx, componente: compIdx }] }] : [],
        ),
      ),
    };
  }

  /** `importar` mode's own pre-checks (the pickers' "elegí paciente/médico" does not apply). */
  function errorImportacion(): string | null {
    if (!importacion) return null;
    if (importacion.paciente.existente?.dadoDeBaja) return "El paciente está dado de baja: reactivalo antes de importar la receta.";
    if (!importacion.paciente.existente) {
      if (!pacienteNuevo.nombre.trim() || !pacienteNuevo.apellido.trim()) return "Completá el nombre y el apellido del paciente.";
      if (!pacienteNuevo.confirmado) return "Confirmá cómo se separan el nombre y el apellido del paciente.";
    }
    if (!importacion.medico.existente) {
      if (!medicoNuevo.nombre.trim() || !medicoNuevo.apellido.trim()) return "Completá el nombre y el apellido del médico.";
      if (!medicoNuevo.confirmado) return "Confirmá cómo se separan el nombre y el apellido del médico.";
      if (!medicoNuevo.matricula.trim()) return "Completá la matrícula del médico.";
    }
    if (!fechaPrescripcion) return "Completá la fecha de prescripción.";
    if (items.some((it) => it.componentes.some((c) => !c.drogaId || !c.unidadMedidaId))) return "Elegí la droga y la unidad de cada componente.";
    return null;
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    const errorImport = errorImportacion();
    if (errorImport) {
      e.preventDefault();
      setClientError(errorImport);
      return;
    }
    if (!importacion && (!pacienteId || !medicoId)) {
      e.preventDefault();
      setClientError("Elegí un paciente y un médico antes de guardar.");
      return;
    }
    try {
      validarItemsReceta(itemsParaEnvio());
    } catch (err) {
      e.preventDefault();
      setClientError(err instanceof Error ? err.message : "La receta tiene errores.");
      return;
    }
    setClientError(null);
    onSubmit(e);
  }

  // Summary (aside): what will be saved, readable at a glance before submitting.
  const pacienteResumen = importacion
    ? importacion.paciente.existente
      ? `${importacion.paciente.existente.nombre} ${importacion.paciente.existente.apellido}`
      : `${pacienteNuevo.nombre} ${pacienteNuevo.apellido}`.trim()
    : pacienteLabel;
  const medicoResumen = importacion
    ? importacion.medico.existente
      ? `${importacion.medico.existente.apellido}, ${importacion.medico.existente.nombre}`
      : [medicoNuevo.apellido, medicoNuevo.nombre].filter((parte) => parte.trim()).join(", ")
    : medicoLabel;
  const totalComponentes = items.reduce((sum, it) => sum + it.componentes.length, 0);
  const cancelarHref = mode !== "editar" ? "/recetas" : !volverA && recetaId ? `/recetas/${recetaId}` : null;
  const errorVisible = clientError ?? (state.status === "error" && state !== errorDescartado ? state.message : null);

  // Next to the paciente: the picker (crear/editar) or the imported paciente's panel (importar).
  const campoDomicilioPaciente = (
    <div className="field">
      <label htmlFor={domicilioPacienteId} className="field-label">
        Domicilio del paciente
      </label>
      <input
        id={domicilioPacienteId}
        name="domicilioPaciente"
        value={domicilioPaciente}
        onChange={(e) => setDomicilioPaciente(e.target.value)}
        disabled={disabled}
        placeholder="Opcional"
        maxLength={MAX_DOMICILIO_PACIENTE}
        autoComplete="off"
        className="input w-full"
      />
    </div>
  );

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className={encabezadoOculto ? "flex flex-col gap-6" : "split-layout"}>
      {mode === "editar" && recetaId ? <input type="hidden" name="id" value={recetaId} /> : null}
      {mode === "editar" && volverA ? <input type="hidden" name="volverA" value={volverA} /> : null}
      <input type="hidden" name="pacienteId" value={pacienteId} />
      <input type="hidden" name="medicoId" value={medicoId} />
      <input type="hidden" name="origen" value={origen} />
      <input type="hidden" name="itemsJson" value={itemsJson} />
      {importacion ? <input type="hidden" name="importacionJson" value={JSON.stringify(payloadImportacion())} /> : null}
      {mode === "editar" && inicial ? (
        <>
          <input type="hidden" name="versionPacienteId" value={inicial.pacienteId} />
          <input type="hidden" name="versionMedicoId" value={inicial.medicoId} />
          <input type="hidden" name="versionFechaPrescripcion" value={inicial.fechaPrescripcion} />
          <input type="hidden" name="versionOrigen" value={inicial.origen} />
          <input type="hidden" name="versionDiagnosticoCodigo" value={inicial.diagnosticoCodigo} />
          <input type="hidden" name="versionDiagnosticoDescripcion" value={inicial.diagnosticoDescripcion} />
          <input type="hidden" name="versionDomicilioPaciente" value={inicial.domicilioPaciente} />
          <input type="hidden" name="itemsVersionJson" value={JSON.stringify(inicial.items.filter((i) => i.id).map((i) => i.id))} />
        </>
      ) : null}
      {encabezadoOculto ? (
        // Not shown here, submitted unchanged (the `version*` fields above still guard against a concurrent edit).
        <>
          <input type="hidden" name="fechaPrescripcion" value={fechaPrescripcion} />
          <input type="hidden" name="diagnosticoCodigo" value={diagnosticoCodigo} />
          <input type="hidden" name="diagnosticoDescripcion" value={diagnosticoDescripcion} />
          <input type="hidden" name="domicilioPaciente" value={domicilioPaciente} />
        </>
      ) : null}

      <div className="flex min-w-0 flex-col gap-6">
        {importacion ? (
          <>
            <ResumenImportacion vistaPrevia={importacion} />
            <AdvertenciasImportacion advertencias={importacion.advertencias} />
            <PanelPersona
              titulo="Paciente"
              existente={importacion.paciente.existente ? `${importacion.paciente.existente.nombre} ${importacion.paciente.existente.apellido}` : null}
              dadoDeBaja={importacion.paciente.existente?.dadoDeBaja}
              completar={importacion.paciente.completar}
              datos={[
                { etiqueta: "DNI", valor: importacion.borrador.paciente.dni },
                { etiqueta: "CUIL", valor: importacion.borrador.paciente.cuil },
                { etiqueta: "Sexo", valor: importacion.borrador.paciente.sexo },
                { etiqueta: "Nacimiento", valor: importacion.borrador.paciente.fechaNacimiento },
                { etiqueta: "Credencial", valor: importacion.borrador.paciente.nroCredencial },
              ]}
            >
              {importacion.paciente.existente ? null : (
                <NombreAConfirmar
                  idBase={`${personaIdBase}-paciente`}
                  quien="paciente"
                  nombreCompleto={importacion.borrador.paciente.nombre?.nombreCompleto ?? null}
                  requiereConfirmacion={importacion.borrador.paciente.nombre?.requiereConfirmacion ?? false}
                  valor={pacienteNuevo}
                  onChange={(patch) => setPacienteNuevo((prev) => ({ ...prev, ...patch }))}
                />
              )}
              <div className="mt-3">{campoDomicilioPaciente}</div>
            </PanelPersona>
            <PanelPersona
              titulo="Médico"
              existente={importacion.medico.existente ? `${importacion.medico.existente.nombre} ${importacion.medico.existente.apellido} (matrícula ${importacion.medico.existente.matricula})` : null}
              completar={importacion.medico.completar}
              datos={[
                { etiqueta: "Especialidad", valor: importacion.borrador.medico.especialidad },
                { etiqueta: "Teléfono", valor: importacion.borrador.medico.telefono },
                { etiqueta: "Dirección", valor: importacion.borrador.medico.direccionRegistrada },
              ]}
            >
              {importacion.medico.existente ? null : (
                <>
                  <NombreAConfirmar
                    idBase={`${personaIdBase}-medico`}
                    quien="médico"
                    nombreCompleto={importacion.borrador.medico.nombre?.nombreCompleto ?? null}
                    requiereConfirmacion={importacion.borrador.medico.nombre?.requiereConfirmacion ?? false}
                    valor={medicoNuevo}
                    onChange={(patch) => setMedicoNuevo((prev) => ({ ...prev, ...patch }))}
                  />
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div className="field">
                      <label htmlFor={`${personaIdBase}-medico-matricula`} className="field-label">
                        Matrícula
                      </label>
                      <input
                        id={`${personaIdBase}-medico-matricula`}
                        value={medicoNuevo.matricula}
                        readOnly={importacion.borrador.medico.matricula !== null}
                        onChange={(e) => setMedicoNuevo((prev) => ({ ...prev, matricula: e.target.value }))}
                        className="input"
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`${personaIdBase}-medico-jurisdiccion`} className="field-label">
                        Jurisdicción
                      </label>
                      <select
                        id={`${personaIdBase}-medico-jurisdiccion`}
                        value={medicoNuevo.matriculaJurisdiccion}
                        disabled={importacion.borrador.medico.matriculaJurisdiccion !== null}
                        onChange={(e) => setMedicoNuevo((prev) => ({ ...prev, matriculaJurisdiccion: e.target.value as JurisdiccionMatricula }))}
                        className="input"
                      >
                        {JURISDICCIONES_MATRICULA.map((j) => (
                          <option key={j} value={j}>
                            {JURISDICCION_MATRICULA_LABELS[j]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              )}
            </PanelPersona>
          </>
        ) : encabezadoOculto ? null : (
          <FormSection id={`${personaIdBase}-personas`} title="Paciente y médico" description="Escribí para buscar. Si no existe, lo creás desde la misma lista.">
            <div className="grid gap-5 md:grid-cols-2">
              <PacientePicker
                selectedId={pacienteId}
                selectedLabel={pacienteLabel}
                onSelect={(id, label) => {
                  setPacienteId(id);
                  setPacienteLabel(label);
                }}
                disabled={disabled}
              />
              <MedicoPicker
                selectedId={medicoId}
                selectedLabel={medicoLabel}
                onSelect={(id, label) => {
                  setMedicoId(id);
                  setMedicoLabel(label);
                }}
                disabled={disabled}
              />
              {campoDomicilioPaciente}
            </div>
          </FormSection>
        )}

        {encabezadoOculto ? null : (
          <FormSection id={`${personaIdBase}-datos`} title="Datos de la receta">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-[auto_minmax(0,1fr)_8rem_minmax(0,2fr)]">
              <div className="flex flex-wrap items-end gap-4">
                <div className="field">
                  <label htmlFor={fechaId} className="field-label">
                    Fecha de prescripción
                  </label>
                  <DateInput
                    id={fechaId}
                    name="fechaPrescripcion"
                    required
                    disabled={disabled}
                    value={fechaPrescripcion}
                    onValueChange={setFechaPrescripcion}
                    min={mode === "editar" || conValidaDesde || importacion?.borrador.fechaValidaDesde ? undefined : fechaPrescripcionMinima(jornadaDe(new Date()))}
                    max={jornadaDe(new Date())}
                  />
                </div>
                {mode === "crear" && conValidaDesde ? (
                  <div className="field">
                    <label htmlFor={fechaValidaDesdeId} className="field-label">
                      Válida desde
                    </label>
                    <DateInput
                      id={fechaValidaDesdeId}
                      name="fechaValidaDesde"
                      required
                      disabled={disabled}
                      value={fechaValidaDesde}
                      onValueChange={setFechaValidaDesde}
                      min={[fechaPrescripcion, fechaPrescripcionMinima(jornadaDe(new Date()))].sort().at(-1)}
                    />
                  </div>
                ) : null}
                {mode === "crear" ? (
                  <label className="toggle-switch max-w-64 text-[0.8125rem] leading-snug text-zinc-500" aria-label="La receta tiene una fecha de validez distinta de su fecha de prescripción">
                    <input type="checkbox" role="switch" checked={conValidaDesde} disabled={disabled} onChange={(e) => setConValidaDesde(e.target.checked)} />
                    {conValidaDesde ? null : "La receta tiene una fecha de validez distinta de su fecha de prescripción."}
                  </label>
                ) : null}
              </div>

              <div className="field">
                <span className="field-label">Origen</span>
                <p className="flex min-h-[2.375rem] items-center text-sm text-zinc-700">{ORIGEN_RECETA_LABELS[origen]}</p>
              </div>

              <div className="field">
                <label htmlFor={diagnosticoCodigoId} className="field-label">
                  CIE-10
                </label>
                <input
                  id={diagnosticoCodigoId}
                  name="diagnosticoCodigo"
                  value={diagnosticoCodigo}
                  onChange={(e) => setDiagnosticoCodigo(e.target.value)}
                  disabled={disabled}
                  placeholder="Ej.: E66.0"
                  maxLength={10}
                  aria-label="Diagnóstico (código CIE-10)"
                  className="input w-full font-mono"
                />
              </div>

              <div className="field">
                <label htmlFor={diagnosticoDescripcionId} className="field-label">
                  Diagnóstico
                </label>
                <input
                  id={diagnosticoDescripcionId}
                  name="diagnosticoDescripcion"
                  value={diagnosticoDescripcion}
                  onChange={(e) => setDiagnosticoDescripcion(e.target.value)}
                  disabled={disabled}
                  aria-label="Diagnóstico (descripción)"
                  className="input w-full"
                />
              </div>
            </div>
          </FormSection>
        )}

        <section aria-labelledby="items-heading" className="flex flex-col gap-4">
          <div className="section-heading mb-0">
            <h2 id="items-heading" className="flex items-center gap-2">
              Ítems <span className="tab-count">{items.length}</span>
            </h2>
          </div>

          {items.map((item, itemIdx) => (
            <fieldset key={itemIdx} className="group-card" disabled={disabled}>
              <legend className="sr-only">Ítem {itemIdx + 1}</legend>
              <div className="group-card-header">
                <span className="index-badge" aria-hidden>
                  {itemIdx + 1}
                </span>
                <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                  {item.descripcion.trim() || FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}
                  <span className="ml-2 font-normal text-zinc-500">
                    {item.componentes.length} {item.componentes.length === 1 ? "componente" : "componentes"}
                  </span>
                </p>
                {items.length > 1 ? (
                  <button type="button" onClick={() => quitarItem(itemIdx)} className="btn btn-danger-ghost btn-sm" aria-label={`Quitar ítem ${itemIdx + 1}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                    <span className="hidden sm:inline">Quitar ítem</span>
                  </button>
                ) : null}
              </div>

              <div className="flex flex-col gap-6 p-4 sm:p-5">
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="field sm:col-span-2">
                    <label htmlFor={`item-${itemIdx}-desc`} className="field-label">
                      Descripción
                    </label>
                    <input id={`item-${itemIdx}-desc`} value={item.descripcion} onChange={(e) => actualizarItem(itemIdx, { descripcion: e.target.value })} placeholder="Opcional" className="input" />
                  </div>

                  <div className="field">
                    <label htmlFor={`item-${itemIdx}-forma`} className="field-label">
                      Forma farmacéutica
                    </label>
                    <select id={`item-${itemIdx}-forma`} value={item.formaFarmaceutica} onChange={(e) => actualizarItem(itemIdx, cambioDeForma(e.target.value as FormaFarmaceutica))} className="input">
                      {FORMAS_FARMACEUTICAS.map((f) => (
                        <option key={f} value={f}>
                          {FORMA_FARMACEUTICA_LABELS[f]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="field">
                    <label htmlFor={`item-${itemIdx}-duracion`} className="field-label">
                      Duración (días)
                    </label>
                    <input
                      id={`item-${itemIdx}-duracion`}
                      type="number"
                      min={1}
                      step={1}
                      value={item.duracionTratamientoDias}
                      onChange={(e) => actualizarItem(itemIdx, { duracionTratamientoDias: e.target.value })}
                      placeholder="Opcional"
                      aria-label="Duración del tratamiento (días)"
                      className="input"
                    />
                  </div>

                  <div className="field">
                    <label htmlFor={`item-${itemIdx}-cu`} className="field-label">
                      Cantidad de unidades
                    </label>
                    <input id={`item-${itemIdx}-cu`} type="number" min={1} step={1} value={item.cantidadUnidades} onChange={(e) => actualizarItem(itemIdx, { cantidadUnidades: e.target.value })} className="input" />
                  </div>

                  {esFormaCapsular(item.formaFarmaceutica) ? (
                    <div className="field">
                      <label htmlFor={`item-${itemIdx}-frac`} className="field-label">
                        Dosis por unidad
                      </label>
                      <select id={`item-${itemIdx}-frac`} value={opcionFraccion(item.fraccionDosisPorUnidad)} onChange={(e) => actualizarItem(itemIdx, { fraccionDosisPorUnidad: e.target.value })} className="input">
                        {FRACCIONES_DOSIS.map((f) => (
                          <option key={f.valor} value={f.valor}>
                            {f.etiqueta}
                          </option>
                        ))}
                        {FRACCIONES_DOSIS.some((f) => f.valor === opcionFraccion(item.fraccionDosisPorUnidad)) ? null : (
                          <option value={item.fraccionDosisPorUnidad}>{item.fraccionDosisPorUnidad}</option>
                        )}
                      </select>
                    </div>
                  ) : null}

                  {esFormaCapsular(item.formaFarmaceutica) ? null : (
                    <div className="field sm:col-span-2">
                      <span id={`item-${itemIdx}-total-label`} className="field-label">
                        Cantidad total (para csp)
                      </span>
                      <div className="flex gap-2" role="group" aria-labelledby={`item-${itemIdx}-total-label`}>
                        <label htmlFor={`item-${itemIdx}-total`} className="sr-only">
                          Cantidad total (para csp)
                        </label>
                        <input id={`item-${itemIdx}-total`} type="text" inputMode="decimal" value={item.cantidadTotal} onChange={(e) => actualizarItem(itemIdx, { cantidadTotal: e.target.value })} className="input w-28 flex-none" />
                        <label htmlFor={`item-${itemIdx}-unidad-total`} className="sr-only">
                          Unidad del total
                        </label>
                        <select id={`item-${itemIdx}-unidad-total`} value={item.unidadTotalId} onChange={(e) => actualizarItem(itemIdx, { unidadTotalId: e.target.value })} className="input min-w-0 flex-1">
                          <option value="">Sin unidad</option>
                          {unidades.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.nombre} ({u.simbolo})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  <div className="field sm:col-span-2">
                    <label htmlFor={`item-${itemIdx}-posologia`} className="field-label">
                      Posología
                    </label>
                    <input id={`item-${itemIdx}-posologia`} value={item.posologia} onChange={(e) => actualizarItem(itemIdx, { posologia: e.target.value })} placeholder="Opcional · Ej.: 1 cada 12 horas" className="input" />
                  </div>

                  <div className="field sm:col-span-2">
                    <label htmlFor={`item-${itemIdx}-obs`} className="field-label">
                      Observaciones
                    </label>
                    <input id={`item-${itemIdx}-obs`} value={item.observaciones} onChange={(e) => actualizarItem(itemIdx, { observaciones: e.target.value })} placeholder="Opcional" className="input" />
                  </div>
                </div>

                <div>
                  <div className="mb-1 border-b border-zinc-200 pb-2">
                    <h3 className="text-sm font-semibold text-zinc-900">Componentes</h3>
                  </div>

                  <ol>
                    {item.componentes.map((c, compIdx) => (
                      <li key={compIdx} className="repeat-row">
                        {importacion && c.drogaTexto ? (
                          <p className="flex w-full flex-wrap items-center gap-2 text-xs text-zinc-600">
                            En la receta: «{c.drogaTexto}»
                            {c.sinMatch ? <ToneBadge tone="warn">Sin coincidencia en el catálogo: elegí la droga</ToneBadge> : null}
                          </p>
                        ) : null}

                        <span className="index-badge mb-2" data-size="sm" aria-hidden>
                          {compIdx + 1}
                        </span>

                        <div className="min-w-[14rem] flex-[2_1_14rem]">
                          <DrogaPicker
                            label={`Componente ${compIdx + 1}: droga`}
                            selectedId={c.drogaId}
                            selectedLabel={c.drogaNombre}
                            selectedSinonimo={c.sinonimo}
                            onSelect={(droga) =>
                              // A new pick (or a clear) always replaces the synonym: it belongs to the droga it was picked with.
                              actualizarComponente(itemIdx, compIdx, {
                                drogaId: droga?.drogaId ?? "",
                                drogaNombre: droga?.nombre ?? "",
                                drogaAliasId: droga?.drogaAliasId ?? null,
                                sinonimo: droga?.sinonimo ?? null,
                                unidadMedidaId: droga ? c.unidadMedidaId || droga.unidadBaseId : "",
                              })
                            }
                          />
                        </div>

                        <div className="field w-36">
                          <label htmlFor={`item-${itemIdx}-comp-${compIdx}-modo`} className="field-label">
                            Modo
                          </label>
                          <select
                            id={`item-${itemIdx}-comp-${compIdx}-modo`}
                            value={c.modoExpresion}
                            onChange={(e) => actualizarComponente(itemIdx, compIdx, { modoExpresion: e.target.value as ModoExpresion, cantidad: e.target.value === "CS" || e.target.value === "CSP" ? "" : c.cantidad })}
                            aria-label={`Componente ${compIdx + 1}: modo de expresión`}
                            className="input input-sm"
                          >
                            {MODOS_EXPRESION.map((m) => (
                              <option key={m} value={m}>
                                {MODO_EXPRESION_LABELS[m]}
                              </option>
                            ))}
                          </select>
                        </div>

                        {c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS" ? (
                          <div className="field w-24">
                            <label htmlFor={`item-${itemIdx}-comp-${compIdx}-cant`} className="field-label">
                              Cantidad
                            </label>
                            <input
                              id={`item-${itemIdx}-comp-${compIdx}-cant`}
                              type="text"
                              inputMode="decimal"
                              value={c.cantidad}
                              onChange={(e) => actualizarComponente(itemIdx, compIdx, { cantidad: e.target.value })}
                              aria-label={`Componente ${compIdx + 1}: cantidad`}
                              className="input input-sm font-mono"
                            />
                          </div>
                        ) : null}

                        <div className="field w-36">
                          <label htmlFor={`item-${itemIdx}-comp-${compIdx}-unidad`} className="field-label">
                            Unidad
                          </label>
                          <select
                            id={`item-${itemIdx}-comp-${compIdx}-unidad`}
                            value={c.unidadMedidaId}
                            onChange={(e) => actualizarComponente(itemIdx, compIdx, { unidadMedidaId: e.target.value })}
                            aria-label={`Componente ${compIdx + 1}: unidad`}
                            className="input input-sm"
                          >
                            <option value="">Elegir unidad</option>
                            {unidades.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.nombre} ({u.simbolo})
                              </option>
                            ))}
                          </select>
                        </div>

                        {item.componentes.length > 1 ? (
                          <div className="ml-auto flex items-center">
                            <button type="button" aria-label={`Quitar componente ${compIdx + 1}`} onClick={() => quitarComponente(itemIdx, compIdx)} className="btn btn-danger-ghost btn-sm btn-icon">
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          </div>
                        ) : null}

                        {importacion && c.sinMatch && c.drogaTexto ? (
                          <label className="flex w-full items-center gap-2 text-xs text-zinc-700">
                            <input type="checkbox" checked={c.recordar ?? false} disabled={!c.drogaId} onChange={(e) => actualizarComponente(itemIdx, compIdx, { recordar: e.target.checked })} />
                            Recordar esta equivalencia («{c.drogaTexto}» = droga elegida)
                          </label>
                        ) : null}
                      </li>
                    ))}
                  </ol>

                  <button type="button" onClick={() => agregarComponente(itemIdx)} className="btn btn-ghost btn-sm mt-2">
                    <Plus className="size-3.5" aria-hidden />
                    Agregar componente
                  </button>
                </div>
              </div>
            </fieldset>
          ))}

          <button type="button" onClick={agregarItem} disabled={disabled} className="add-row-button">
            <Plus className="size-4" aria-hidden />
            Agregar ítem
          </button>
        </section>
      </div>

      {/* In the toma workspace the resumen sits right below the ítems (and above the fichas técnicas) at every width, never as a sticky side column. */}
      {encabezadoOculto ? (
        // Toma workspace: one compact bar right below the ítems (and above the fichas técnicas) at every width.
        <section aria-labelledby={`${personaIdBase}-resumen`} className="panel bg-zinc-50">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3">
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="text-sm">
                <h2 id={`${personaIdBase}-resumen`} className="inline font-semibold text-zinc-900">
                  Resumen
                </h2>
                <span className="text-zinc-500 tabular-nums">
                  {" "}
                  · {items.length} {items.length === 1 ? "ítem" : "ítems"} ({totalComponentes} {totalComponentes === 1 ? "componente" : "componentes"})
                </span>
              </div>
              {itemsSinGuardar ? (
                <p className="flex items-start gap-1.5 text-xs text-zinc-500">
                  <TriangleAlert className="mt-px size-3.5 flex-none text-amber-600" aria-hidden />
                  <span>
                    <strong className="font-medium text-amber-700">Cambios no guardados.</strong> Al guardar, la ficha técnica de cada ítem se recalcula automáticamente.
                  </span>
                </p>
              ) : (
                <p className="text-xs text-zinc-500">Al guardar, la ficha técnica de cada ítem se recalcula automáticamente.</p>
              )}
            </div>
            <div className="flex flex-none items-center gap-2">
              {itemsSinGuardar ? (
                <button type="button" onClick={restablecer} disabled={isPending} className="btn btn-secondary">
                  <RotateCcw className="size-4" aria-hidden />
                  Deshacer cambios
                </button>
              ) : null}
              <SubmitButton label="Guardar cambios" pending={isPending} sinGuardar={itemsSinGuardar} sinCambios={!itemsSinGuardar} compacto />
            </div>
          </div>
          {errorVisible ? (
            <div className="px-5 pb-3">
              <div role="alert" className="alert alert-danger">
                <AlertCircle aria-hidden />
                <p>{errorVisible}</p>
              </div>
            </div>
          ) : null}
        </section>
      ) : (
        <aside className="split-aside flex flex-col gap-4" aria-label="Resumen y guardado">
          {puedePresupuestar && mode !== "editar" ? <PresupuestoPanel items={itemsParaEnvio()} /> : null}

          <div className="panel">
            <div className="panel-header">
              <h2>Resumen</h2>
            </div>
            <div className="panel-body flex flex-col gap-4">
              <dl className="summary-dl">
                <>
                  <dt>Paciente</dt>
                  <dd data-empty={!pacienteResumen || undefined} title={pacienteResumen || undefined}>
                    {pacienteResumen || "Sin elegir"}
                  </dd>
                  <dt>Médico</dt>
                  <dd data-empty={!medicoResumen || undefined} title={medicoResumen || undefined}>
                    {medicoResumen || "Sin elegir"}
                  </dd>
                  <dt>Prescripción</dt>
                  <dd data-empty={!fechaPrescripcion || undefined} className="tabular-nums">
                    {fechaVisible(fechaPrescripcion) || "Sin fecha"}
                  </dd>
                  <dt>Origen</dt>
                  <dd>{ORIGEN_RECETA_LABELS[origen]}</dd>
                </>
                <dt>Ítems</dt>
                <dd className="tabular-nums">
                  {items.length} ({totalComponentes} {totalComponentes === 1 ? "componente" : "componentes"})
                </dd>
              </dl>

              {mode !== "editar" ? (
                <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                  {/* `crear` reads it from the form; `importar` sends it inside `importacionJson`. */}
                  <input type="checkbox" name={mode === "crear" ? "pagada" : undefined} checked={pagada} disabled={disabled} onChange={(e) => setPagada(e.target.checked)} />
                  Pagada
                </label>
              ) : null}

              {errorVisible ? (
                <div role="alert" className="alert alert-danger">
                  <AlertCircle aria-hidden />
                  <p>{errorVisible}</p>
                </div>
              ) : null}

              <div className="flex flex-col gap-2">
                <SubmitButton label={mode === "crear" ? "Crear receta" : mode === "editar" ? "Guardar cambios" : "Confirmar importación"} pending={isPending} sinGuardar={itemsSinGuardar || encabezadoSinGuardar} />
                {itemsSinGuardar || encabezadoSinGuardar ? (
                  <button type="button" onClick={restablecer} disabled={isPending} className="btn btn-secondary w-full">
                    <RotateCcw className="size-4" aria-hidden />
                    Deshacer cambios
                  </button>
                ) : null}
                {cancelarHref ? (
                  <Link href={cancelarHref} className="btn btn-ghost w-full">
                    Cancelar
                  </Link>
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      )}
    </form>
  );
}

interface NombreAConfirmarProps {
  idBase: string;
  quien: "paciente" | "médico";
  nombreCompleto: string | null;
  requiereConfirmacion: boolean;
  valor: { nombre: string; apellido: string; confirmado: boolean };
  onChange: (patch: Partial<{ nombre: string; apellido: string; confirmado: boolean }>) => void;
}

/**
 * Nombre/apellido of a person the import will create. With 3+ words the
 * split is a guess (spec "Separación de nombres"), so the user must confirm
 * it -- editing either field also counts as reviewing it, but the explicit
 * checkbox is what unlocks the submit.
 */
function NombreAConfirmar({ idBase, quien, nombreCompleto, requiereConfirmacion, valor, onChange }: NombreAConfirmarProps) {
  return (
    <div className="flex flex-col gap-3">
      {nombreCompleto ? (
        <p className="text-sm text-zinc-700">
          En la receta: <strong className="text-zinc-900">{nombreCompleto}</strong>
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="field">
          <label htmlFor={`${idBase}-nombre`} className="field-label">
            Nombre
          </label>
          <input id={`${idBase}-nombre`} value={valor.nombre} onChange={(e) => onChange({ nombre: e.target.value })} className="input" />
        </div>
        <div className="field">
          <label htmlFor={`${idBase}-apellido`} className="field-label">
            Apellido
          </label>
          <input id={`${idBase}-apellido`} value={valor.apellido} onChange={(e) => onChange({ apellido: e.target.value })} className="input" />
        </div>
      </div>
      {requiereConfirmacion ? (
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
          <input type="checkbox" checked={valor.confirmado} onChange={(e) => onChange({ confirmado: e.target.checked })} />
          Confirmo el nombre y el apellido del {quien}
        </label>
      ) : null}
    </div>
  );
}
