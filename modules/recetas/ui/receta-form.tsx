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
 */
import { useActionState, useEffect, useId, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { crearRecetaAction, editarRecetaAction } from "./actions";
import { IDLE_STATE } from "./action-state";
import { PacientePicker } from "./paciente-picker";
import { MedicoPicker } from "./medico-picker";
import { DrogaPicker } from "./droga-picker";
import { FORMAS_FARMACEUTICAS, MODOS_EXPRESION, validarItemsReceta } from "../domain/receta";
import type { FormaFarmaceutica, ModoExpresion } from "../domain/receta";
import type { UnidadOpcion } from "../infrastructure/receta-repository";

interface ComponenteState {
  id?: string;
  drogaId: string;
  drogaNombre: string;
  cantidad: string;
  unidadMedidaId: string;
  modoExpresion: ModoExpresion;
  esPrincipioActivo: boolean;
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
    componentes: [nuevoComponente()],
  };
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn btn-primary">
      {pending ? "Guardando…" : label}
    </button>
  );
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
  origen: "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO";
  items: ItemState[];
}

export interface RecetaFormProps {
  mode: "crear" | "editar";
  unidades: UnidadOpcion[];
  disabled: boolean;
  recetaId?: string;
  inicial?: RecetaFormInicial;
}

export function RecetaForm({ mode, unidades, disabled, recetaId, inicial }: RecetaFormProps) {
  const action = mode === "crear" ? crearRecetaAction : editarRecetaAction;
  const [state, formAction] = useActionState(action, IDLE_STATE);
  const router = useRouter();

  const [pacienteId, setPacienteId] = useState(inicial?.pacienteId ?? "");
  const [pacienteLabel, setPacienteLabel] = useState(inicial?.pacienteLabel ?? "");
  const [medicoId, setMedicoId] = useState(inicial?.medicoId ?? "");
  const [medicoLabel, setMedicoLabel] = useState(inicial?.medicoLabel ?? "");
  const [fechaPrescripcion, setFechaPrescripcion] = useState(inicial?.fechaPrescripcion ?? "");
  const [recetaFisicaRecibida, setRecetaFisicaRecibida] = useState(false);
  const [items, setItems] = useState<ItemState[]>(inicial?.items ?? [nuevoItem()]);
  const [clientError, setClientError] = useState<string | null>(null);

  const fechaId = useId();

  useEffect(() => {
    if (state.status === "success" && state.id) {
      router.push(`/recetas/${state.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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
      componentes: it.componentes.map((c) => ({
        drogaId: c.drogaId,
        cantidad: c.cantidad.trim().length > 0 ? c.cantidad.trim() : null,
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
        esPrincipioActivo: c.esPrincipioActivo,
      })),
    }));
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    if (!pacienteId || !medicoId) {
      e.preventDefault();
      setClientError("Elegí un paciente y un médico antes de guardar.");
      return;
    }
    try {
      validarItemsReceta(itemsParaEnvio());
      setClientError(null);
    } catch (err) {
      e.preventDefault();
      setClientError(err instanceof Error ? err.message : "La receta tiene errores.");
    }
  }

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      {mode === "editar" && recetaId ? <input type="hidden" name="id" value={recetaId} /> : null}
      <input type="hidden" name="pacienteId" value={pacienteId} />
      <input type="hidden" name="medicoId" value={medicoId} />
      <input type="hidden" name="fechaPrescripcion" value={fechaPrescripcion} />
      <input type="hidden" name="origen" value="PRESENCIAL" />
      <input type="hidden" name="itemsJson" value={JSON.stringify(itemsParaEnvio())} />
      {mode === "editar" && inicial ? (
        <>
          <input type="hidden" name="versionPacienteId" value={inicial.pacienteId} />
          <input type="hidden" name="versionMedicoId" value={inicial.medicoId} />
          <input type="hidden" name="versionFechaPrescripcion" value={inicial.fechaPrescripcion} />
          <input type="hidden" name="versionOrigen" value={inicial.origen} />
          <input type="hidden" name="itemsVersionJson" value={JSON.stringify(inicial.items.filter((i) => i.id).map((i) => i.id))} />
        </>
      ) : null}

      <PacientePicker selectedId={pacienteId} selectedLabel={pacienteLabel} onSelect={(id, label) => { setPacienteId(id); setPacienteLabel(label); }} disabled={disabled} />
      <MedicoPicker selectedId={medicoId} selectedLabel={medicoLabel} onSelect={(id, label) => { setMedicoId(id); setMedicoLabel(label); }} disabled={disabled} />

      <div className="flex flex-wrap gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor={fechaId} className="text-sm font-medium">
            Fecha de prescripción
          </label>
          <input id={fechaId} type="date" required disabled={disabled} value={fechaPrescripcion} onChange={(e) => setFechaPrescripcion(e.target.value)} max={new Date().toISOString().slice(0, 10)} className="input" />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Origen</span>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Presencial (único origen disponible por ahora)</p>
        </div>

        {mode === "crear" ? (
          <div className="flex flex-col gap-1">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" name="recetaFisicaRecibida" checked={recetaFisicaRecibida} onChange={(e) => setRecetaFisicaRecibida(e.target.checked)} disabled={disabled} />
              Receta física ya recibida
            </label>
          </div>
        ) : null}
      </div>

      <section aria-labelledby="items-heading" className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 id="items-heading" className="text-lg font-medium">
            Ítems
          </h2>
          <button type="button" onClick={agregarItem} disabled={disabled} className="btn btn-secondary">
            + Agregar ítem
          </button>
        </div>

        {items.map((item, itemIdx) => (
          <fieldset key={itemIdx} className="card p-4" disabled={disabled}>
            <legend className="px-1 text-sm font-medium">Ítem {itemIdx + 1}</legend>

            <div className="mb-3 flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-desc`} className="text-sm">
                  Descripción
                </label>
                <input id={`item-${itemIdx}-desc`} value={item.descripcion} onChange={(e) => actualizarItem(itemIdx, { descripcion: e.target.value })} className="input input-sm" />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-forma`} className="text-sm">
                  Forma farmacéutica
                </label>
                <select id={`item-${itemIdx}-forma`} value={item.formaFarmaceutica} onChange={(e) => actualizarItem(itemIdx, { formaFarmaceutica: e.target.value as FormaFarmaceutica })} className="input input-sm">
                  {FORMAS_FARMACEUTICAS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-cu`} className="text-sm">
                  Cantidad de unidades
                </label>
                <input id={`item-${itemIdx}-cu`} type="number" min={1} step={1} value={item.cantidadUnidades} onChange={(e) => actualizarItem(itemIdx, { cantidadUnidades: e.target.value })} className="w-24 input input-sm" />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-frac`} className="text-sm">
                  Fracción de dosis por unidad
                </label>
                <input id={`item-${itemIdx}-frac`} type="text" inputMode="decimal" value={item.fraccionDosisPorUnidad} onChange={(e) => actualizarItem(itemIdx, { fraccionDosisPorUnidad: e.target.value })} className="w-24 input input-sm" />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-total`} className="text-sm">
                  Cantidad total (para csp)
                </label>
                <input id={`item-${itemIdx}-total`} type="text" inputMode="decimal" value={item.cantidadTotal} onChange={(e) => actualizarItem(itemIdx, { cantidadTotal: e.target.value })} className="w-28 input input-sm" />
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-unidad-total`} className="text-sm">
                  Unidad del total
                </label>
                <select id={`item-${itemIdx}-unidad-total`} value={item.unidadTotalId} onChange={(e) => actualizarItem(itemIdx, { unidadTotalId: e.target.value })} className="input input-sm">
                  <option value="">—</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.nombre} ({u.simbolo})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label htmlFor={`item-${itemIdx}-obs`} className="text-sm">
                  Observaciones
                </label>
                <input id={`item-${itemIdx}-obs`} value={item.observaciones} onChange={(e) => actualizarItem(itemIdx, { observaciones: e.target.value })} className="input input-sm" />
              </div>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-medium">Componentes</h3>
              <div className="flex gap-2">
                <button type="button" onClick={() => agregarComponente(itemIdx)} className="btn btn-secondary btn-sm">
                  + Agregar componente
                </button>
                {items.length > 1 ? (
                  <button type="button" onClick={() => quitarItem(itemIdx)} className="btn btn-danger btn-sm">
                    Quitar ítem
                  </button>
                ) : null}
              </div>
            </div>

            <ol className="flex flex-col gap-3">
              {item.componentes.map((c, compIdx) => (
                <li key={compIdx} className="card p-4">
                  <div className="mb-2 flex flex-wrap items-end gap-3">
                    <DrogaPicker
                      label={`Componente ${compIdx + 1}: droga`}
                      selectedId={c.drogaId}
                      selectedLabel={c.drogaNombre}
                      onSelect={(id, nombre, unidadBaseId) =>
                        actualizarComponente(itemIdx, compIdx, { drogaId: id, drogaNombre: nombre, unidadMedidaId: id ? c.unidadMedidaId || unidadBaseId : "" })
                      }
                    />

                    <div className="flex flex-col gap-1">
                      <label htmlFor={`item-${itemIdx}-comp-${compIdx}-modo`} className="text-xs">
                        Modo de expresión
                      </label>
                      <select
                        id={`item-${itemIdx}-comp-${compIdx}-modo`}
                        value={c.modoExpresion}
                        onChange={(e) => actualizarComponente(itemIdx, compIdx, { modoExpresion: e.target.value as ModoExpresion, cantidad: e.target.value === "CS" || e.target.value === "CSP" ? "" : c.cantidad })}
                        className="input input-sm"
                      >
                        {MODOS_EXPRESION.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>

                    {c.modoExpresion === "TOTAL" || c.modoExpresion === "POR_DOSIS" ? (
                      <div className="flex flex-col gap-1">
                        <label htmlFor={`item-${itemIdx}-comp-${compIdx}-cant`} className="text-xs">
                          Cantidad
                        </label>
                        <input id={`item-${itemIdx}-comp-${compIdx}-cant`} type="text" inputMode="decimal" value={c.cantidad} onChange={(e) => actualizarComponente(itemIdx, compIdx, { cantidad: e.target.value })} className="w-24 input input-sm" />
                      </div>
                    ) : null}

                    <div className="flex flex-col gap-1">
                      <label htmlFor={`item-${itemIdx}-comp-${compIdx}-unidad`} className="text-xs">
                        Unidad
                      </label>
                      <select id={`item-${itemIdx}-comp-${compIdx}-unidad`} value={c.unidadMedidaId} onChange={(e) => actualizarComponente(itemIdx, compIdx, { unidadMedidaId: e.target.value })} className="input input-sm">
                        <option value="">—</option>
                        {unidades.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.nombre} ({u.simbolo})
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={c.esPrincipioActivo} onChange={(e) => actualizarComponente(itemIdx, compIdx, { esPrincipioActivo: e.target.checked })} />
                      Principio activo
                    </label>

                    <div className="flex gap-1">
                      <button type="button" aria-label={`Mover componente ${compIdx + 1} hacia arriba`} disabled={compIdx === 0} onClick={() => moverComponente(itemIdx, compIdx, -1)} className="btn btn-secondary btn-sm">
                        ↑
                      </button>
                      <button type="button" aria-label={`Mover componente ${compIdx + 1} hacia abajo`} disabled={compIdx === item.componentes.length - 1} onClick={() => moverComponente(itemIdx, compIdx, 1)} className="btn btn-secondary btn-sm">
                        ↓
                      </button>
                      {item.componentes.length > 1 ? (
                        <button type="button" aria-label={`Quitar componente ${compIdx + 1}`} onClick={() => quitarComponente(itemIdx, compIdx)} className="btn btn-danger btn-sm">
                          Quitar
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </fieldset>
        ))}
      </section>

      {clientError ? (
        <p role="alert" className="text-sm text-red-600">
          {clientError}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="text-sm text-red-600">
          {state.message}
        </p>
      ) : null}

      <div>
        <SubmitButton label={mode === "crear" ? "Crear receta" : "Guardar cambios"} />
      </div>
    </form>
  );
}
