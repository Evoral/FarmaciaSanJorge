"use client";

/**
 * "Elaborar lote" (openspec/changes/lotes-elaborados, EL1-EL8): a dilución of a droga or a lot of a droga elaborated
 * from its materias primas. The user picks the droga to produce; the form loads its fórmula and the eligible lots of
 * every droga involved (`datosParaElaborarAction`): the droga itself for a dilución, the fórmula's components for a
 * lot, plus any droga the user adds (the excipiente of a dilución). Each lot gets a quantity (`cantidad_<partidaId>`,
 * PHYSICAL, in its droga's unidad base); "Precargar con la fórmula" fills them in consumption order. An added droga
 * can be removed again.
 *
 * The cantidad producida defaults to the sum of what is used when every lot used is in the produced droga's unidad
 * base (a dilución in lactosa: droga + excipiente); the user corrects it when something was lost. With components in
 * other units (a solid in a liquid) it can not be summed and is typed.
 *
 * Shown live, from the same pure functions the command validates with: the dilución's concentration, the lot's cost
 * per unit (only with `stock.valorizado.ver`: the lots come without costo otherwise) and the latest vencimiento it
 * may have. Everything typed survives an error (`SimpleForm`); on success it hands the new partida to its dialog
 * (./elaborar-lote-dialog.tsx).
 */
import { useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Plus, Wand2, X } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { dec } from "@/shared/decimal";
import { interpretarNumero, numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { formatNumero } from "@/shared/format/cantidad";
import { formatFecha } from "@/shared/format/fecha";
import { escalarFormula } from "@/modules/drogas/domain/formula";
import { MENSAJE_CONTRALOR_ELABORACION, costoUnitarioDeLote, potenciaDeDilucion, vencimientoMaximo, type ConsumoElaboracion } from "../domain/elaboracion-lote";
import type { DatosParaElaborar, PartidaElegibleParaElaborar } from "../application/datos-para-elaborar";
import { datosParaElaborarAction, elaborarLoteAction } from "./actions";
import { buscarDrogasStockAction } from "./buscar-drogas-stock-action";

type Tipo = "DILUCION" | "FORMULA";

export interface ElaborarLoteFormProps {
  /** Opened for a droga (a partida's "Diluir", the pesaje's "crear dilución"): its data, already loaded. */
  inicial: { datos: DatosParaElaborar; tipo: Tipo; partidaId: string | null } | null;
  /** After a success: the new partida and the success message. */
  onElaborado: (partidaId: string, message: string | undefined) => void;
  /** E.g. the dialog's "Cancelar" (`type="button"`), next to the submit. */
  extraActions?: ReactNode;
}

/** The typed quantity as a canonical decimal string, `null` when blank or not a positive number. */
function cantidadValida(texto: string | undefined): string | null {
  if (!texto || texto.trim() === "") return null;
  const numero = interpretarNumero(texto);
  return numero.ok && dec(numero.valor).greaterThan(0) ? numero.valor : null;
}

async function buscarDrogas(q: string): Promise<readonly ComboboxOption[]> {
  const items = await buscarDrogasStockAction(q);
  return items.map((item) => ({ value: item.drogaId, label: item.drogaNombre, description: item.disponible, sinonimo: item.sinonimo ?? undefined }));
}

export function ElaborarLoteForm({ inicial, onElaborado, extraActions }: ElaborarLoteFormProps) {
  const [tipo, setTipo] = useState<Tipo>(inicial?.tipo ?? "DILUCION");
  const [datos, setDatos] = useState<DatosParaElaborar | null>(inicial?.datos ?? null);
  const [droga, setDroga] = useState<ComboboxOption | null>(inicial ? { value: inicial.datos.droga.id, label: inicial.datos.droga.nombre } : null);
  const [extras, setExtras] = useState<{ id: string; nombre: string }[]>([]);
  const [agregando, setAgregando] = useState<ComboboxOption | null>(null);
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  /** What the user typed; `null` = follow the sum of what is used. */
  const [producidaEditada, setProducidaEditada] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const consulta = useRef(0);
  const enfocar = useRef<string | null>(inicial?.partidaId ?? null);

  async function cargar(drogaId: string, extraIds: string[]) {
    const turno = ++consulta.current;
    setCargando(true);
    const respuesta = await datosParaElaborarAction(drogaId, extraIds);
    if (turno !== consulta.current) return;
    setCargando(false);
    if (respuesta.status === "error") {
      setError(respuesta.message);
      return;
    }
    setError(null);
    setDatos(respuesta.datos);
  }

  function elegirDroga(opcion: ComboboxOption | null) {
    setDroga(opcion);
    setExtras([]);
    setCantidades({});
    setProducidaEditada(null);
    setDatos(null);
    if (opcion) void cargar(opcion.value, []);
  }

  function agregarDroga(opcion: ComboboxOption | null) {
    setAgregando(null);
    if (!opcion || !droga || extras.some((e) => e.id === opcion.value)) return;
    const nuevas = [...extras, { id: opcion.value, nombre: opcion.label }];
    setExtras(nuevas);
    void cargar(droga.value, nuevas.map((e) => e.id));
  }

  function quitarDroga(drogaId: string) {
    setExtras((actuales) => actuales.filter((e) => e.id !== drogaId));
    const deLaDroga = new Set((datos?.partidasPorDroga[drogaId] ?? []).map((p) => p.id));
    setCantidades((actuales) => Object.fromEntries(Object.entries(actuales).filter(([partidaId]) => !deLaDroga.has(partidaId))));
  }

  // The drogas whose lots are shown, in order: what the tipo consumes, then the ones the user added.
  const grupos = useMemo(() => {
    if (!datos) return [];
    const base =
      tipo === "DILUCION"
        ? [{ id: datos.droga.id, nombre: datos.droga.nombre, simbolo: datos.droga.unidadBaseSimbolo, porFormula: null as string | null }]
        : (datos.formula?.componentes ?? []).map((c) => ({ id: c.drogaId, nombre: c.drogaNombre, simbolo: c.unidadBaseSimbolo, porFormula: c.cantidad }));
    const vistos = new Set(base.map((g) => g.id));
    const agregados = extras
      .filter((e) => !vistos.has(e.id) && !(tipo === "FORMULA" && e.id === datos.droga.id))
      .map((e) => ({ id: e.id, nombre: e.nombre, simbolo: datos.partidasPorDroga[e.id]?.[0]?.unidadBaseSimbolo ?? "", porFormula: null }));
    return [...base.map((g) => ({ ...g, agregada: false })), ...agregados.map((g) => ({ ...g, agregada: true }))].map((g) => ({
      ...g,
      partidas: datos.partidasPorDroga[g.id] ?? [],
    }));
  }, [datos, tipo, extras]);

  const partidasVisibles = useMemo(() => grupos.flatMap((g) => g.partidas), [grupos]);
  const consumos: ConsumoElaboracion[] = partidasVisibles.flatMap((p) => {
    const cantidad = cantidadValida(cantidades[p.id]);
    if (!cantidad) return [];
    return [
      {
        partidaId: p.id,
        lote: p.lote,
        drogaId: p.drogaId,
        drogaNombre: p.drogaNombre,
        cantidad,
        cantidadDisponible: p.cantidadDisponible,
        costoUnitario: p.costoUnitario ?? "0",
        potenciaDeclarada: p.potenciaDeclarada,
        fechaVencimiento: p.fechaVencimiento,
      },
    ];
  });
  // The sum of what is used, only when every lot used is in the produced droga's unidad base.
  const suma =
    datos && consumos.length > 0 && consumos.every((c) => partidasVisibles.find((p) => p.id === c.partidaId)?.unidadBaseSimbolo === datos.droga.unidadBaseSimbolo)
      ? consumos.reduce((total, c) => total.plus(dec(c.cantidad)), dec(0))
      : null;
  const cantidadProducida = producidaEditada ?? (suma ? numeroParaInput(suma.toFixed()) : "");
  const producida = cantidadValida(cantidadProducida);
  const sumaDistinta = suma !== null && producidaEditada !== null && (producida === null || !suma.equals(dec(producida)));
  const potencia = datos && tipo === "DILUCION" && producida && consumos.some((c) => c.drogaId === datos.droga.id) ? potenciaDeDilucion(consumos, datos.droga.id, producida) : null;
  const conCosto = consumos.length > 0 && consumos.every((c) => partidasVisibles.find((p) => p.id === c.partidaId)?.costoUnitario !== null);
  const costo = conCosto && producida ? costoUnitarioDeLote(consumos, producida) : null;
  const vencimiento = vencimientoMaximo(consumos);
  const controlada = datos !== null && (datos.droga.tipoControl !== "NINGUNO" || consumos.some((c) => partidasVisibles.find((p) => p.id === c.partidaId)?.drogaTipoControl !== "NINGUNO"));
  const bloqueadaPorContralor = datos?.contralorActivo === true && controlada;

  /** EL3: each component scaled to the cantidad producida, taken from its lots in consumption order (open first, then FEFO). */
  function precargar() {
    if (!datos?.formula || !producida) return;
    const nuevas: Record<string, string> = {};
    for (const componente of escalarFormula({ drogaId: datos.droga.id, cantidadReferencia: datos.formula.cantidadReferencia, componentes: datos.formula.componentes }, producida)) {
      let resto = componente.cantidad;
      for (const p of datos.partidasPorDroga[componente.drogaId] ?? []) {
        if (!resto.greaterThan(0)) break;
        const toma = resto.greaterThan(dec(p.cantidadDisponible)) ? dec(p.cantidadDisponible) : resto;
        nuevas[p.id] = numeroParaInput(toma.toDecimalPlaces(4).toFixed());
        resto = resto.minus(toma);
      }
    }
    setCantidades(nuevas);
  }

  return (
    <SimpleForm
      action={elaborarLoteAction}
      accion="stock.lote.elaborar"
      submitLabel="Elaborar lote"
      pendingLabel="Elaborando…"
      submitDisabled={!datos || bloqueadaPorContralor}
      submitDisabledReason={bloqueadaPorContralor ? MENSAJE_CONTRALOR_ELABORACION : !datos ? "Elegí la droga a elaborar." : undefined}
      extraActions={extraActions}
      // The dialog closes and toasts it: no inline success message.
      successMessage={() => undefined}
      onSuccess={(state) => {
        if (state.partidaId) onElaborado(state.partidaId, state.message);
      }}
    >
      <input type="hidden" name="tipo" value={tipo} />
      <input type="hidden" name="drogaProducidaId" value={droga?.value ?? ""} />
      {tipo === "FORMULA" && datos?.formula ? <input type="hidden" name="formulaId" value={datos.formula.id} /> : null}

      <fieldset className="field">
        <legend className="field-label">Qué se elabora</legend>
        <div className="flex flex-wrap gap-4 text-[0.8125rem]">
          <label className="flex items-center gap-2">
            <input type="radio" checked={tipo === "DILUCION"} onChange={() => setTipo("DILUCION")} />
            Dilución de una droga
          </label>
          <label className="flex items-center gap-2">
            <input type="radio" checked={tipo === "FORMULA"} onChange={() => setTipo("FORMULA")} />
            Lote desde sus materias primas
          </label>
        </div>
        <p className="field-help">
          {tipo === "DILUCION"
            ? "Un lote de la misma droga con menor concentración (por ejemplo, 1 % en lactosa): se pesa como cualquier lote, con su pureza."
            : "Un lote de otra droga (por ejemplo, un jarabe) hecho con sus materias primas."}
        </p>
      </fieldset>

      <Combobox
        id="drogaProducida-buscar"
        label={tipo === "DILUCION" ? "Droga a diluir" : "Droga a elaborar"}
        placeholder="Buscar droga"
        search={buscarDrogas}
        value={droga}
        onChange={elegirDroga}
      />

      {error ? (
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>{error}</p>
        </div>
      ) : null}
      {cargando && !datos ? <p className="text-xs text-zinc-500">Cargando lotes…</p> : null}

      {datos ? (
        <>
          {bloqueadaPorContralor ? (
            <div role="alert" className="alert alert-warn">
              <CircleAlert aria-hidden />
              <p>{MENSAJE_CONTRALOR_ELABORACION}</p>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="field">
              <label htmlFor="cantidadProducida" className="field-label">
                Cantidad producida <span className="font-normal text-zinc-400">({datos.droga.unidadBaseSimbolo})</span>
              </label>
              <input
                id="cantidadProducida"
                name="cantidadProducida"
                value={cantidadProducida}
                onChange={(e) => setProducidaEditada(e.target.value)}
                required
                inputMode="decimal"
                autoComplete="off"
                className="input font-mono"
              />
              <p className="field-help">
                {sumaDistinta ? (
                  <>
                    Lo usado suma {formatNumero(suma)} {datos.droga.unidadBaseSimbolo}.{" "}
                    <button type="button" onClick={() => setProducidaEditada(null)} className="underline">
                      Usar la suma
                    </button>
                  </>
                ) : suma !== null ? (
                  "La suma de lo usado. Corregila si hubo pérdida."
                ) : consumos.length > 0 ? (
                  "Lo usado está en otras unidades: indicá el total del lote obtenido."
                ) : (
                  "Total del lote obtenido: se completa con la suma de lo usado."
                )}
              </p>
            </div>
            <div className="field">
              <span className="field-label">Lote</span>
              <p className="py-1.5 font-mono text-[0.8125rem] font-semibold text-zinc-900">{datos.proximoLote[tipo]}</p>
              <p className="field-help">Lo asigna el sistema al elaborar.</p>
            </div>
            <div className="field">
              <label htmlFor="fechaVencimiento" className="field-label">
                Vencimiento <span className="font-normal text-zinc-400">(opcional)</span>
              </label>
              <DateInput id="fechaVencimiento" name="fechaVencimiento" />
              <p className="field-help">
                {vencimiento ? `Vacío: ${formatFecha(new Date(`${vencimiento}T00:00:00Z`))}, el del primer componente que vence. No puede ser posterior.` : "Vacío: el del primer componente que vence."}
              </p>
            </div>
          </div>

          {tipo === "FORMULA" ? (
            datos.formula ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem]">
                <span className="text-zinc-700">
                  Fórmula: por cada {formatNumero(datos.formula.cantidadReferencia)} {datos.droga.unidadBaseSimbolo},{" "}
                  {datos.formula.componentes.map((c) => `${formatNumero(c.cantidad)} ${c.unidadBaseSimbolo} de ${c.drogaNombre}`).join(", ")}.
                </span>
                <button type="button" onClick={precargar} disabled={!producida} className="btn btn-secondary btn-sm">
                  <Wand2 className="size-4" aria-hidden />
                  Precargar con la fórmula
                </button>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">
                {datos.droga.nombre} no tiene fórmula: agregá sus materias primas abajo. Para cargarla, editá la droga en el catálogo.
              </p>
            )
          ) : null}

          <div className="flex flex-col gap-4" data-field="componentes">
            {grupos.map((grupo) => (
              <GrupoDeLotes
                key={grupo.id}
                nombre={grupo.nombre}
                simbolo={grupo.simbolo}
                porFormula={grupo.porFormula}
                onQuitar={grupo.agregada ? () => quitarDroga(grupo.id) : null}
                partidas={grupo.partidas}
                cantidades={cantidades}
                enfocar={enfocar}
                onCantidad={(partidaId, valor) => setCantidades((actuales) => ({ ...actuales, [partidaId]: valor }))}
              />
            ))}
          </div>

          <Combobox
            id="agregar-droga-buscar"
            label={tipo === "DILUCION" ? "Agregar el excipiente u otra droga" : "Agregar otra materia prima"}
            placeholder="Buscar droga o excipiente"
            search={buscarDrogas}
            value={agregando}
            onChange={agregarDroga}
            size="sm"
            helperText={
              <span className="inline-flex items-center gap-1">
                <Plus className="size-3" aria-hidden />
                Sus lotes aparecen arriba para indicar cuánto se usa.
              </span>
            }
          />

          <div className="field">
            <label htmlFor="observacion" className="field-label">
              Observación <span className="font-normal text-zinc-400">(opcional)</span>
            </label>
            <input id="observacion" name="observacion" maxLength={500} autoComplete="off" className="input" />
          </div>

          <dl className="summary-dl rounded-md border border-zinc-200 p-3" aria-live="polite">
            {tipo === "DILUCION" ? (
              <>
                <dt>Concentración resultante</dt>
                <dd className="font-mono tabular-nums">{potencia ? `${formatNumero(potencia, 6)} %` : "-"}</dd>
              </>
            ) : null}
            {costo ? (
              <>
                <dt>Costo por {datos.droga.unidadBaseSimbolo}</dt>
                <dd className="font-mono tabular-nums">$ {formatNumero(costo, 4)}</dd>
              </>
            ) : null}
            <dt>Lotes consumidos</dt>
            <dd className="tabular-nums">{consumos.length}</dd>
          </dl>
        </>
      ) : null}
    </SimpleForm>
  );
}

function GrupoDeLotes({
  nombre,
  simbolo,
  porFormula,
  onQuitar,
  partidas,
  cantidades,
  enfocar,
  onCantidad,
}: {
  nombre: string;
  simbolo: string;
  /** The fórmula's quantity per its cantidad de referencia, shown as a reminder. */
  porFormula: string | null;
  /** Removes a droga the user added; `null` for the ones the tipo consumes. */
  onQuitar: (() => void) | null;
  partidas: readonly PartidaElegibleParaElaborar[];
  cantidades: Record<string, string>;
  /** A partida to focus once (opened from its "Diluir"). */
  enfocar: { current: string | null };
  onCantidad: (partidaId: string, valor: string) => void;
}) {
  return (
    <section className="rounded-md border border-zinc-200" aria-label={`Lotes de ${nombre}`}>
      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-3 py-1">
        <h3 className="py-1 text-[0.8125rem] font-semibold text-zinc-900">
          {nombre}
          {porFormula ? <span className="ml-2 font-normal text-zinc-500">({formatNumero(porFormula)} {simbolo} por fórmula)</span> : null}
        </h3>
        {onQuitar ? (
          <button type="button" onClick={onQuitar} aria-label={`Quitar ${nombre}`} className="btn btn-ghost btn-sm btn-icon">
            <X className="size-4" aria-hidden />
          </button>
        ) : null}
      </div>
      {partidas.length === 0 ? (
        <p className="px-3 py-2 text-xs text-zinc-500">Sin lotes disponibles: no tiene saldo libre sin vencer.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-1.5">
                Lote
              </th>
              <th scope="col" className="hidden px-3 py-1.5 sm:table-cell">
                Vence
              </th>
              <th scope="col" className="px-3 py-1.5 text-right">
                Disponible
              </th>
              <th scope="col" className="px-3 py-1.5 text-right">
                Usar ({simbolo})
              </th>
            </tr>
          </thead>
          <tbody>
            {partidas.map((p) => {
              const id = `cantidad_${p.id}`;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-1.5">
                    <label htmlFor={id} className="font-mono font-semibold">
                      {p.lote}
                    </label>
                    <span className="block text-xs text-zinc-500">
                      {p.potenciaDeclarada !== null ? `Pureza ${formatNumero(p.potenciaDeclarada, 6)} %` : "Pureza 100 %"}
                      {p.fechaApertura ? " · abierta" : ""}
                    </span>
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-1.5 tabular-nums sm:table-cell">
                    {p.fechaVencimiento ? formatFecha(new Date(`${p.fechaVencimiento}T00:00:00Z`)) : "No vence"}
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono tabular-nums">
                    {formatNumero(p.cantidadDisponible)} {p.unidadBaseSimbolo}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <input
                      id={id}
                      name={id}
                      value={cantidades[p.id] ?? ""}
                      onChange={(e) => onCantidad(p.id, e.target.value)}
                      ref={(el) => {
                        if (el && enfocar.current === p.id) {
                          enfocar.current = null;
                          el.focus();
                        }
                      }}
                      inputMode="decimal"
                      autoComplete="off"
                      className="input w-28 text-right font-mono"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
