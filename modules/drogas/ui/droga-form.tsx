"use client";

/**
 * Crear/editar droga form (FASE 4 point 4.2, DP-12). The page provides the
 * surrounding panel. "Clase" (migration 0063): on alta it follows the name's
 * suggestion (domain/sugerir-clase.ts) until the user picks one by hand;
 * on edición it is never changed for the user.
 *
 * "Otros nombres" (docs/specs/sinonimos-droga.md) are the same rows on alta
 * and edición (fields `sinonimo-0`, `sinonimo-1`...), saved with the rest of
 * the form; on edición they start with the droga's vigente synonyms and
 * `sinonimosCargados` tells the command which ones the form showed. The name
 * and every row are checked live against the catalog (`./drogas-existentes.tsx`,
 * the droga's own matches ignored): submit is disabled while the name belongs
 * to another vigente droga; a taken synonym is flagged under its row and
 * rejected by the command on its own field.
 *
 * Saved and unsaved names look different on purpose: a stored synonym is a
 * boxed row with a check (green and "Guardado" for a few seconds right after
 * the save that added it), a new one is an input, and on edición a note says
 * when there are name changes not saved yet.
 */
import { useEffect, useId, useState } from "react";
import type { DrogaExistente } from "./buscar-drogas-catalogo-action";
import { Check, Plus, X } from "lucide-react";
import { crearDrogaAction, editarDrogaAction } from "./actions";
import { DrogasExistentesAviso, coincidenciaExacta, useDrogasExistentes } from "./drogas-existentes";
import { normalizarTexto } from "../domain/normalizar";
import { SINONIMO_MAX_LARGO } from "../domain/sinonimo";
import { SimpleForm } from "@/shared/ui/simple-form";
import { CLASES_DROGA, CLASE_DROGA_LABELS, TIPOS_CONTROL, TIPO_CONTROL_LABELS, type ClaseDroga } from "@/modules/drogas/domain/droga";
import { sugerirClase, type SugerenciaClase } from "@/modules/drogas/domain/sugerir-clase";

export interface UnidadOpcion {
  id: string;
  nombre: string;
  simbolo: string;
}

export interface DrogaFormProps {
  mode: "crear" | "editar";
  unidades: UnidadOpcion[];
  droga?: {
    id: string;
    nombre: string;
    unidadBaseId: string;
    esControlada: boolean;
    tipoControl: string;
    clase: string;
    stockMinimo: string;
    tienePartidas: boolean;
    /** Vigente synonyms, as typed. */
    sinonimos: readonly { id: string; texto: string }[];
  };
  disabled: boolean;
}

export function DrogaForm({ mode, unidades, droga, disabled }: DrogaFormProps) {
  const action = mode === "crear" ? crearDrogaAction : editarDrogaAction;
  const clasificacionDisabled = disabled || (mode === "editar" && (droga?.tienePartidas ?? false));
  const [clase, setClase] = useState<ClaseDroga>((droga?.clase as ClaseDroga | undefined) ?? "DROGA");
  const [sugerencia, setSugerencia] = useState<SugerenciaClase | null>(null);
  const [claseElegida, setClaseElegida] = useState(mode === "editar");
  const [nombre, setNombre] = useState(droga?.nombre ?? "");
  const [sinonimos, setSinonimos] = useState(() => filasCargadas(droga));
  const [siguienteKey, setSiguienteKey] = useState(0);
  const avisoId = useId();

  // After a save the page re-renders with the stored droga: start again from it (new synonym ids, maybe a new name).
  const firma = droga ? [droga.nombre, ...droga.sinonimos.map((s) => s.id)].join("\u0000") : "";
  const [firmaCargada, setFirmaCargada] = useState(firma);
  const [recientes, setRecientes] = useState<ReadonlySet<string>>(new Set());
  if (firma !== firmaCargada) {
    // Synonyms that were not loaded before this re-render were just saved: highlight them for a moment.
    const antes = new Set(sinonimos.flatMap((f) => (f.guardadoId ? [f.guardadoId] : [])));
    setRecientes(new Set((droga?.sinonimos ?? []).filter((s) => !antes.has(s.id)).map((s) => s.id)));
    setFirmaCargada(firma);
    setNombre(droga?.nombre ?? "");
    setSinonimos(filasCargadas(droga));
  }

  useEffect(() => {
    if (recientes.size === 0) return;
    const timer = setTimeout(() => setRecientes(new Set()), RESALTADO_MS);
    return () => clearTimeout(timer);
  }, [recientes]);

  const guardadosVisibles = new Set(sinonimos.flatMap((f) => (f.guardadoId ? [f.guardadoId] : [])));
  const sinGuardar =
    !!droga && (sinonimos.some((f) => !f.guardadoId && normalizarTexto(f.texto).length > 0) || droga.sinonimos.some((s) => !guardadosVisibles.has(s.id)));

  const esAlta = mode === "crear";
  const cambiaNombre = esAlta || normalizarTexto(nombre) !== normalizarTexto(droga?.nombre ?? "");
  const existentes = sinEstaDroga(useDrogasExistentes(cambiaNombre ? nombre : ""), droga?.id);
  const nombreOcupado = coincidenciaExacta(nombre, existentes)?.baja === false;

  function agregarFila() {
    setSinonimos((filas) => [...filas, { key: `n-${siguienteKey}`, texto: "" }]);
    setSiguienteKey((k) => k + 1);
  }

  function onSuccess() {
    setNombre("");
    setSinonimos([]);
  }

  function onNombre(nombre: string) {
    setNombre(nombre);
    if (claseElegida) return;
    const nueva = sugerirClase(nombre);
    setSugerencia(nueva);
    setClase(nueva?.clase ?? "DROGA");
  }

  return (
    <SimpleForm
      action={action}
      submitLabel={mode === "crear" ? "Crear droga" : "Guardar cambios"}
      submitDisabled={nombreOcupado}
      submitDisabledReason={nombreOcupado ? "Ya existe una droga con ese nombre." : undefined}
      onSuccess={esAlta ? onSuccess : undefined}
    >
      {mode === "editar" && droga ? (
        <>
          <input type="hidden" name="id" value={droga.id} />
          <input type="hidden" name="versionNombre" value={droga.nombre} />
          <input type="hidden" name="versionUnidadBaseId" value={droga.unidadBaseId} />
          <input type="hidden" name="versionEsControlada" value={String(droga.esControlada)} />
          <input type="hidden" name="versionTipoControl" value={droga.tipoControl} />
          <input type="hidden" name="versionClase" value={droga.clase} />
          <input type="hidden" name="versionStockMinimo" value={droga.stockMinimo} />
        </>
      ) : null}

      <div className="field">
        <label htmlFor="nombre" className="field-label">
          Nombre
        </label>
        <input
          id="nombre"
          name="nombre"
          defaultValue={droga?.nombre ?? ""}
          required
          disabled={disabled}
          autoComplete="off"
          onChange={(e) => onNombre(e.target.value)}
          aria-describedby={existentes.length > 0 ? avisoId : undefined}
          className="input"
        />
        <DrogasExistentesAviso id={avisoId} texto={nombre} drogas={existentes} />
      </div>

      {droga ? (
        <>
          <input type="hidden" name="sinonimosEnviados" value="1" disabled={disabled} />
          {droga.sinonimos.map((s) => (
            <input key={s.id} type="hidden" name="sinonimosCargados" value={s.id} disabled={disabled} />
          ))}
        </>
      ) : null}
      <fieldset className="field">
        <legend className="field-label">
          Otros nombres <span className="font-normal text-zinc-400">(opcional)</span>
        </legend>
        {sinonimos.map((fila, i) =>
          fila.guardadoId ? (
            <SinonimoGuardado
              key={fila.key}
              index={i}
              texto={fila.texto}
              reciente={recientes.has(fila.guardadoId)}
              disabled={disabled}
              onQuitar={() => setSinonimos((filas) => filas.filter((f) => f.key !== fila.key))}
            />
          ) : (
            <SinonimoFila
              key={fila.key}
              index={i}
              texto={fila.texto}
              nombre={nombre}
              drogaId={droga?.id}
              disabled={disabled}
              onChange={(texto) => setSinonimos((filas) => filas.map((f) => (f.key === fila.key ? { ...f, texto } : f)))}
              onQuitar={() => setSinonimos((filas) => filas.filter((f) => f.key !== fila.key))}
            />
          ),
        )}
        {sinGuardar ? (
          <p role="status" className="mb-2 text-xs text-amber-700">
            Hay cambios en otros nombres sin guardar: tocá «Guardar cambios».
          </p>
        ) : null}
        <button type="button" onClick={agregarFila} disabled={disabled} className="btn btn-ghost btn-sm self-start">
          <Plus className="size-4" aria-hidden />
          Agregar otro nombre
        </button>
        <p className="field-help">
          Sinónimos de la misma sustancia, no drogas aparte: por ejemplo «Petrolato» para «Vaselina sólida», como figura en recetas o facturas. Buscando
          cualquiera de ellos se encuentra esta droga; recetas, libros y etiquetas usan siempre el nombre principal.
        </p>
      </fieldset>

      <div className="field sm:max-w-[50%]">
        <label htmlFor="clase" className="field-label">
          Clase
        </label>
        <select
          id="clase"
          name="clase"
          value={clase}
          disabled={disabled}
          onChange={(e) => {
            setClase(e.target.value as ClaseDroga);
            setClaseElegida(true);
          }}
          aria-describedby="clase-ayuda"
          className="input"
        >
          {CLASES_DROGA.map((c) => (
            <option key={c} value={c}>
              {CLASE_DROGA_LABELS[c]}
            </option>
          ))}
        </select>
        <p id="clase-ayuda" className="field-help">
          {!claseElegida && sugerencia ? `Sugerido por «${sugerencia.motivo}» en el nombre. ` : ""}
          Excipientes y materiales llevan stock y costo, pero no van al libro recetario ni pueden ser controlados.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="unidadBaseId" className="field-label">
            Unidad base
          </label>
          <select id="unidadBaseId" name="unidadBaseId" defaultValue={droga?.unidadBaseId ?? ""} required disabled={clasificacionDisabled} className="input">
            <option value="" disabled>
              Elegí una unidad
            </option>
            {unidades.map((unidad) => (
              <option key={unidad.id} value={unidad.id}>
                {unidad.nombre} ({unidad.simbolo})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="tipoControl" className="field-label">
            Tipo de control
          </label>
          <select id="tipoControl" name="tipoControl" defaultValue={droga?.tipoControl ?? "NINGUNO"} disabled={clasificacionDisabled} className="input">
            {TIPOS_CONTROL.map((tipo) => (
              <option key={tipo} value={tipo}>
                {TIPO_CONTROL_LABELS[tipo]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="field-help -mt-1">
        Unidad en la que se utiliza la droga en el laboratorio. El stock y el libro contralor se registran en esta unidad; las compras se convierten automáticamente,
        independientemente de la unidad indicada en la factura.
      </p>
      {clasificacionDisabled && mode === "editar" ? (
        <p className="field-help -mt-1">Esta droga ya tiene partidas: la unidad base y el tipo de control no se pueden modificar.</p>
      ) : null}

      <div className="field sm:max-w-[50%]">
        <label htmlFor="stockMinimo" className="field-label">
          Stock mínimo
        </label>
        <input id="stockMinimo" name="stockMinimo" defaultValue={droga?.stockMinimo ?? "0"} required disabled={disabled} inputMode="decimal" className="input font-mono" />
      </div>
    </SimpleForm>
  );
}

const RESALTADO_MS = 4000;

/** A row of "Otros nombres": `guardadoId` = the stored synonym it shows (boxed, read-only); none = a new name being typed. */
interface FilaSinonimo {
  key: string;
  texto: string;
  guardadoId?: string;
}

function filasCargadas(droga: DrogaFormProps["droga"]): FilaSinonimo[] {
  return (droga?.sinonimos ?? []).map((s) => ({ key: `s-${s.id}`, texto: s.texto, guardadoId: s.id }));
}

/** A stored synonym: a boxed, read-only row (submitted as-is through a hidden field) that can only be removed. */
function SinonimoGuardado({ index, texto, reciente, disabled, onQuitar }: { index: number; texto: string; reciente: boolean; disabled: boolean; onQuitar: () => void }) {
  return (
    <div
      className={`mb-2 flex items-center gap-2 rounded-md border px-3 py-1.5 text-[0.8125rem] transition-colors duration-700 ${
        reciente ? "border-emerald-300 bg-emerald-50" : "border-zinc-200 bg-zinc-50"
      }`}
    >
      <input type="hidden" name={`sinonimo-${index}`} value={texto} disabled={disabled} />
      <Check className={`size-4 shrink-0 ${reciente ? "text-emerald-600" : "text-zinc-400"}`} aria-hidden />
      <span className="min-w-0 flex-1 truncate text-zinc-800">{texto}</span>
      {reciente ? (
        <span role="status" className="text-xs font-medium text-emerald-700">
          Guardado
        </span>
      ) : null}
      <button type="button" onClick={onQuitar} disabled={disabled} aria-label={`Quitar «${texto}»`} className="btn btn-ghost btn-sm btn-icon -my-1 -mr-2">
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

/** On edición the droga being edited is not a duplicate of itself. */
function sinEstaDroga(drogas: DrogaExistente[], drogaId: string | undefined): DrogaExistente[] {
  return drogaId ? drogas.filter((d) => d.id !== drogaId) : drogas;
}

/** One "Otros nombres" row: the input, its remove button and a short notice when the text is already taken. */
function SinonimoFila({
  index,
  texto,
  nombre,
  drogaId,
  disabled,
  onChange,
  onQuitar,
}: {
  index: number;
  texto: string;
  nombre: string;
  drogaId?: string;
  disabled: boolean;
  onChange: (texto: string) => void;
  onQuitar: () => void;
}) {
  const id = useId();
  const existentes = sinEstaDroga(useDrogasExistentes(texto), drogaId);
  const ocupado = coincidenciaExacta(texto, existentes);
  const esElNombre = normalizarTexto(texto).length > 0 && normalizarTexto(texto) === normalizarTexto(nombre);
  const aviso = esElNombre
    ? "Es el mismo nombre principal."
    : ocupado && !ocupado.baja
      ? normalizarTexto(ocupado.nombre) === normalizarTexto(texto)
        ? `«${ocupado.nombre}» ya es otra droga.`
        : `Ya es otro nombre de «${ocupado.nombre}».`
      : null;

  return (
    <div className="mb-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Otro nombre {index + 1}
        </label>
        <input
          id={id}
          name={`sinonimo-${index}`}
          value={texto}
          onChange={(e) => onChange(e.target.value)}
          maxLength={SINONIMO_MAX_LARGO}
          disabled={disabled}
          autoComplete="off"
          aria-describedby={aviso ? `${id}-aviso` : undefined}
          className="input"
        />
        <button type="button" onClick={onQuitar} disabled={disabled} aria-label={`Quitar el otro nombre ${index + 1}`} className="btn btn-ghost btn-sm btn-icon">
          <X className="size-4" aria-hidden />
        </button>
      </div>
      {aviso ? (
        <p id={`${id}-aviso`} role="status" className="mt-1 text-xs text-red-700">
          {aviso}
        </p>
      ) : null}
    </div>
  );
}
