"use client";

/**
 * Crear/editar receta (FASE 6 points 6.1/6.3). A sectioned form that holds
 * one or more ítems, each with one or more componentes -- dynamic rows are
 * plain array state (add/remove buttons, up/down reordering for
 * componentes since V3 depends on the CSP componente being LAST in the
 * array: `orden` is assigned from array position server-side, see
 * modules/recetas/infrastructure/receta-repository.ts, so the UI never
 * sends an explicit order number). Every row control has a `<label>` and
 * every add/remove/move control is a real `<button>` (native keyboard
 * operation: Enter/Space activate, Tab moves focus -- no custom
 * mouse-only affordances).
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
 */
import { useActionState, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { crearRecetaAction, editarRecetaAction, importarRecetaAction } from "./actions";
import { IDLE_STATE } from "./action-state";
import { PacientePicker } from "./paciente-picker";
import { MedicoPicker } from "./medico-picker";
import { DrogaPicker } from "./droga-picker";
import { PresupuestoPanel } from "./presupuesto-panel";
import { AdvertenciasImportacion, PanelPersona, ResumenImportacion } from "./importacion-paneles";
import type { VistaPreviaImportacion } from "../domain/importacion-receta";
import { JURISDICCIONES_MATRICULA, JURISDICCION_MATRICULA_LABELS } from "@/modules/medicos/domain/medico";
import type { JurisdiccionMatricula } from "@/modules/medicos/domain/medico";
import { FORMAS_FARMACEUTICAS, MODOS_EXPRESION, ORIGEN_RECETA_LABELS, fechaPrescripcionMinima, validarItemsReceta } from "../domain/receta";
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
  drogaNombre: string;
  cantidad: string;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
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
  return { drogaId: "", drogaNombre: "", cantidad: "", unidadMedidaId: "", modoExpresion: "TOTAL", esPrincipioActivo: false };
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

function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="btn btn-primary w-full">
      {pending ? <span className="spinner border-white/40 border-t-white" aria-hidden /> : <Save className="size-4" aria-hidden />}
      {pending ? "Guardando…" : label}
    </button>
  );
}

/** A titled block of the form. */
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

/** `2026-09-01` -> `01/09/2026` for the summary (empty stays empty). */
function fechaVisible(iso: string): string {
  const [y, m, d] = iso.split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
}

function moveItem<T>(arr: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (target < 0 || target >= arr.length) return arr;
  const copy = [...arr];
  [copy[index], copy[target]] = [copy[target]!, copy[index]!];
  return copy;
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
        cantidad: c.cantidad,
        unidadMedidaId: match?.unidadMedidaId ?? "",
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
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

export function RecetaForm({ mode, unidades, disabled, recetaId, inicial, vistaPrevia, puedePresupuestar = false, volverA }: RecetaFormProps) {
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

  const fechaId = useId();
  const personaIdBase = useId();
  const diagnosticoCodigoId = useId();
  const diagnosticoDescripcionId = useId();

  useEffect(() => {
    if (state.status === "success" && state.id) {
      // Created -> the list with its success banner; edited -> the receta. Notices are codes only (domain/avisos-generacion.ts).
      router.push(state.redirigirA ?? `/recetas/${state.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useFieldErrors(formRef, errorFieldsOf(state));

  function actualizarItem(idx: number, patch: Partial<ItemState>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function actualizarComponente(itemIdx: number, compIdx: number, patch: Partial<ComponenteState>) {
    setItems((prev) =>
      prev.map((it, i) => (i === itemIdx ? { ...it, componentes: it.componentes.map((c, j) => (j === compIdx ? { ...c, ...patch } : c)) } : it)),
    );
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

  function moverComponente(itemIdx: number, compIdx: number, dir: -1 | 1) {
    setItems((prev) => prev.map((it, i) => (i === itemIdx ? { ...it, componentes: moveItem(it.componentes, compIdx, dir) } : it)));
  }

  function itemsParaEnvio() {
    return items.map((it) => ({
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
        cantidad: c.cantidad.trim().length > 0 ? c.cantidad.trim() : null,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
      })),
    }));
  }

  /** `recetas.importar`'s input (application/importar-receta.ts) -- the server re-matches and re-validates all of it. */
  function payloadImportacion() {
    if (!importacion) return null;
    const { paciente, medico } = importacion;
    const b = importacion.borrador;
    return {
      emisor: b.emisor,
      nroRecetaEmisor: b.nroRecetaEmisor,
      urlVerificacion: b.urlVerificacion,
      fechaPrescripcion,
      fechaValidaDesde: b.fechaValidaDesde,
      diagnosticoCodigo,
      diagnosticoDescripcion,
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
      equivalencias: items.flatMap((it) =>
        it.componentes.filter((c) => c.sinMatch && c.recordar && c.drogaId && c.drogaTexto).map((c) => ({ aliasTexto: c.drogaTexto!, drogaId: c.drogaId })),
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
  const errorVisible = clientError ?? (state.status === "error" ? state.message : null);

  return (
    <form ref={formRef} action={formAction} onSubmit={handleSubmit} noValidate className="split-layout">
      {mode === "editar" && recetaId ? <input type="hidden" name="id" value={recetaId} /> : null}
      {mode === "editar" && volverA ? <input type="hidden" name="volverA" value={volverA} /> : null}
      <input type="hidden" name="pacienteId" value={pacienteId} />
      <input type="hidden" name="medicoId" value={medicoId} />
      <input type="hidden" name="origen" value={origen} />
      <input type="hidden" name="itemsJson" value={JSON.stringify(itemsParaEnvio())} />
      {importacion ? <input type="hidden" name="importacionJson" value={JSON.stringify(payloadImportacion())} /> : null}
      {mode === "editar" && inicial ? (
        <>
          <input type="hidden" name="versionPacienteId" value={inicial.pacienteId} />
          <input type="hidden" name="versionMedicoId" value={inicial.medicoId} />
          <input type="hidden" name="versionFechaPrescripcion" value={inicial.fechaPrescripcion} />
          <input type="hidden" name="versionOrigen" value={inicial.origen} />
          <input type="hidden" name="versionDiagnosticoCodigo" value={inicial.diagnosticoCodigo} />
          <input type="hidden" name="versionDiagnosticoDescripcion" value={inicial.diagnosticoDescripcion} />
          <input type="hidden" name="itemsVersionJson" value={JSON.stringify(inicial.items.filter((i) => i.id).map((i) => i.id))} />
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
        ) : (
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
            </div>
          </FormSection>
        )}

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
                    <select id={`item-${itemIdx}-forma`} value={item.formaFarmaceutica} onChange={(e) => actualizarItem(itemIdx, { formaFarmaceutica: e.target.value as FormaFarmaceutica })} className="input">
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

                  <div className="field">
                    <label htmlFor={`item-${itemIdx}-frac`} className="field-label">
                      Fracción de dosis por unidad
                    </label>
                    <input id={`item-${itemIdx}-frac`} type="text" inputMode="decimal" value={item.fraccionDosisPorUnidad} onChange={(e) => actualizarItem(itemIdx, { fraccionDosisPorUnidad: e.target.value })} className="input" />
                  </div>

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

                  <div className="field sm:col-span-2">
                    <label htmlFor={`item-${itemIdx}-posologia`} className="field-label">
                      Posología
                    </label>
                    <input id={`item-${itemIdx}-posologia`} value={item.posologia} onChange={(e) => actualizarItem(itemIdx, { posologia: e.target.value })} placeholder="Ej.: 1 cada 12 horas" className="input" />
                  </div>

                  <div className="field sm:col-span-2">
                    <label htmlFor={`item-${itemIdx}-obs`} className="field-label">
                      Observaciones
                    </label>
                    <input id={`item-${itemIdx}-obs`} value={item.observaciones} onChange={(e) => actualizarItem(itemIdx, { observaciones: e.target.value })} className="input" />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 pb-2">
                    <h3 className="text-sm font-semibold text-zinc-900">Componentes</h3>
                    <p className="text-xs text-zinc-500">El orden se guarda tal cual: el componente csp va último.</p>
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
                            onSelect={(id, nombre, unidadBaseId) =>
                              actualizarComponente(itemIdx, compIdx, { drogaId: id, drogaNombre: nombre, unidadMedidaId: id ? c.unidadMedidaId || unidadBaseId : "" })
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

                        <label className="flex min-h-[2rem] items-center gap-2 text-xs text-zinc-700">
                          <input type="checkbox" checked={c.esPrincipioActivo} onChange={(e) => actualizarComponente(itemIdx, compIdx, { esPrincipioActivo: e.target.checked })} />
                          Principio activo
                        </label>

                        <div className="ml-auto flex items-center gap-0.5">
                          <button type="button" aria-label={`Mover componente ${compIdx + 1} hacia arriba`} disabled={compIdx === 0} onClick={() => moverComponente(itemIdx, compIdx, -1)} className="btn btn-ghost btn-sm btn-icon">
                            <ArrowUp className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            aria-label={`Mover componente ${compIdx + 1} hacia abajo`}
                            disabled={compIdx === item.componentes.length - 1}
                            onClick={() => moverComponente(itemIdx, compIdx, 1)}
                            className="btn btn-ghost btn-sm btn-icon"
                          >
                            <ArrowDown className="size-3.5" aria-hidden />
                          </button>
                          {item.componentes.length > 1 ? (
                            <button type="button" aria-label={`Quitar componente ${compIdx + 1}`} onClick={() => quitarComponente(itemIdx, compIdx)} className="btn btn-danger-ghost btn-sm btn-icon">
                              <Trash2 className="size-3.5" aria-hidden />
                            </button>
                          ) : null}
                        </div>

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

      <aside className="split-aside flex flex-col gap-4" aria-label="Resumen y guardado">
        {puedePresupuestar && mode !== "editar" ? <PresupuestoPanel items={itemsParaEnvio()} /> : null}

        <div className="panel">
          <div className="panel-header">
            <h2>Resumen</h2>
          </div>
          <div className="panel-body flex flex-col gap-4">
            <dl className="summary-dl">
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
              <dt>Ítems</dt>
              <dd className="tabular-nums">
                {items.length} ({totalComponentes} {totalComponentes === 1 ? "componente" : "componentes"})
              </dd>
            </dl>

            {errorVisible ? (
              <div role="alert" className="alert alert-danger">
                <AlertCircle aria-hidden />
                <p>{errorVisible}</p>
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <SubmitButton label={mode === "crear" ? "Crear receta" : mode === "editar" ? "Guardar cambios" : "Confirmar importación"} pending={isPending} />
              {cancelarHref ? (
                <Link href={cancelarHref} className="btn btn-ghost w-full">
                  Cancelar
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </aside>
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
