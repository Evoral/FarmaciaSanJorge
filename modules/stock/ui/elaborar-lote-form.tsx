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
 * per unit (only with `stock.valorizado.ver`: the lots come without costo otherwise) and its vencimiento, not chosen:
 * the earliest of the active drugs it consumes (EL5). The lot's name for its etiqueta is suggested from the droga and,
 * for a dilución, its proportion ("Clonazepam 1:100"); once typed, the user's name stays.
 *
 * Every mass is shown and typed in mg, with its grams in grey below (as on the ficha técnica); each quantity reaches
 * the command in its droga's unidad base through a hidden input (`CantidadEnFormulario`). Everything typed survives an
 * error (`SimpleForm`); on success it hands the new partida to its dialog (./elaborar-lote-dialog.tsx).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CircleAlert, Plus, Wand2, X } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { FIELD_ERROR_EVENT, type FieldErrorEventDetail } from "@/shared/ui/field-errors";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { dec } from "@/shared/decimal";
import { interpretarNumero, numeroParaInput } from "@/shared/decimal/numero-ingresado";
import { formatNumero } from "@/shared/format/cantidad";
import { formatFecha } from "@/shared/format/fecha";
import { escalarFormula } from "@/modules/drogas/domain/formula";
import {
  MENSAJE_CONTRALOR_ELABORACION,
  NOMBRE_LOTE_MAX,
  aUnidadBase,
  aUnidadDeFormulario,
  costoUnitarioDeLote,
  nombreSugeridoLote,
  potenciaDeDilucion,
  simboloEnFormulario,
  vencimientoDelLote,
  type ConsumoElaboracion,
} from "../domain/elaboracion-lote";
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

/** "= 0,5 g" under a mass shown in mg; `null` for any other unit or an empty value. */
function enGramos(valorFormulario: string | null, simbolo: string): string | null {
  if (!valorFormulario || simboloEnFormulario(simbolo) !== "mg") return null;
  return `= ${formatNumero(dec(valorFormulario).dividedBy(1000))} g`;
}

/** A quantity of unidad base `simbolo` as the form shows it: "500 mg". */
function textoEnFormulario(valorBase: string, simbolo: string): string {
  return `${formatNumero(aUnidadDeFormulario(valorBase, simbolo))} ${simboloEnFormulario(simbolo)}`;
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
  /** `null` = the suggested name (`nombreSugeridoLote`), which follows the droga and the dilución's proportion. */
  const [nombreEditado, setNombreEditado] = useState<string | null>(null);
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
    setNombreEditado(null);
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
        cantidad: aUnidadBase(cantidad, p.unidadBaseSimbolo).toFixed(),
        cantidadDisponible: p.cantidadDisponible,
        costoUnitario: p.costoUnitario ?? "0",
        potenciaDeclarada: p.potenciaDeclarada,
        fechaVencimiento: p.fechaVencimiento,
        drogaClase: p.drogaClase,
      },
    ];
  });
  // In the form's unit (mg for a mass): the sum of what is used, only when every lot used is in the produced droga's.
  const simboloProducido = datos ? simboloEnFormulario(datos.droga.unidadBaseSimbolo) : "";
  const simboloDe = (partidaId: string) => simboloEnFormulario(partidasVisibles.find((p) => p.id === partidaId)?.unidadBaseSimbolo ?? "");
  const suma =
    datos && consumos.length > 0 && consumos.every((c) => simboloDe(c.partidaId) === simboloProducido)
      ? consumos.reduce((total, c) => total.plus(dec(cantidadValida(cantidades[c.partidaId]) ?? 0)), dec(0))
      : null;
  const cantidadProducida = producidaEditada ?? (suma ? numeroParaInput(suma.toFixed()) : "");
  const producidaEnFormulario = cantidadValida(cantidadProducida);
  /** The cantidad producida in the produced droga's unidad base. */
  const producida = datos && producidaEnFormulario ? aUnidadBase(producidaEnFormulario, datos.droga.unidadBaseSimbolo).toFixed() : null;
  const sumaDistinta = suma !== null && producidaEditada !== null && (producidaEnFormulario === null || !suma.equals(dec(producidaEnFormulario)));
  // Red until it is filled: with lots in different units (mL and mg) nothing can be summed and it must be typed.
  const producidaPendiente = consumos.length > 0 && producida === null;
  const unidadesUsadas = [...new Set(consumos.map((c) => simboloDe(c.partidaId)))];
  const potencia = datos && tipo === "DILUCION" && producida && consumos.some((c) => c.drogaId === datos.droga.id) ? potenciaDeDilucion(consumos, datos.droga.id, producida) : null;
  const conCosto = consumos.length > 0 && consumos.every((c) => partidasVisibles.find((p) => p.id === c.partidaId)?.costoUnitario !== null);
  const costo = conCosto && producida ? costoUnitarioDeLote(consumos, producida) : null;
  const vencimiento = vencimientoDelLote(consumos);
  const nombre = nombreEditado ?? (datos ? nombreSugeridoLote(datos.droga.nombre, potencia) : "");
  const controlada = datos !== null && (datos.droga.tipoControl !== "NINGUNO" || consumos.some((c) => partidasVisibles.find((p) => p.id === c.partidaId)?.drogaTipoControl !== "NINGUNO"));
  const bloqueadaPorContralor = datos?.contralorActivo === true && controlada;

  /** EL3: each component scaled to the cantidad producida, taken from its lots in consumption order (open first, then FEFO). */
  function precargar() {
    if (!datos?.formula || !producida) return;
    const nuevas: Record<string, string> = {};
    for (const componente of escalarFormula({ drogaId: datos.droga.id, cantidadReferencia: datos.formula.cantidadReferencia, componentes: datos.formula.componentes }, producida)) {
      // The fórmula is in ACTIVE: each lot gives its active (quantity x its pureza), as on the ficha técnica.
      let resto = componente.cantidad;
      for (const p of datos.partidasPorDroga[componente.drogaId] ?? []) {
        if (!resto.greaterThan(0)) break;
        const pureza = dec(p.potenciaDeclarada ?? 100).dividedBy(100);
        if (!pureza.greaterThan(0)) continue;
        const activoDisponible = dec(p.cantidadDisponible).times(pureza);
        const activo = resto.greaterThan(activoDisponible) ? activoDisponible : resto;
        const toma = activo.equals(activoDisponible) ? dec(p.cantidadDisponible) : activo.dividedBy(pureza);
        nuevas[p.id] = numeroParaInput(aUnidadDeFormulario(toma, p.unidadBaseSimbolo).toDecimalPlaces(4).toFixed());
        resto = resto.minus(activo);
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <span className="field-label">Lote</span>
              <p className="py-1.5 font-mono text-[0.8125rem] font-semibold text-zinc-900">{datos.proximoLote[tipo]}</p>
              <p className="field-help">Lo asigna el sistema al elaborar.</p>
            </div>
            <div className="field">
              <span className="field-label">Vencimiento</span>
              <p className="py-1.5 text-[0.8125rem] font-semibold text-zinc-900">
                {vencimiento ? formatFecha(new Date(`${vencimiento}T00:00:00Z`)) : "—"}
              </p>
              <p className="field-help">El de la droga activa que vence primero. Sigue sus reanálisis y se descarta con ella.</p>
            </div>
          </div>

          {tipo === "FORMULA" ? (
            datos.formula ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-[0.8125rem]">
                <span className="text-zinc-700">
                  Fórmula: por cada {textoEnFormulario(datos.formula.cantidadReferencia, datos.droga.unidadBaseSimbolo)},{" "}
                  {datos.formula.componentes.map((c) => `${textoEnFormulario(c.cantidad, c.unidadBaseSimbolo)} de ${c.drogaNombre}`).join(", ")}.
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
            {/* The total under the "Usar" column: same right edge as the lots' inputs (border + px-3 of each group). */}
            <div className="flex flex-col items-end gap-1 border border-transparent px-3">
              <div className="flex items-center gap-3">
                <label htmlFor="cantidadProducida" className="text-[0.8125rem] font-semibold text-zinc-900">
                  Cantidad producida ({simboloProducido})
                </label>
                <div className="text-right">
                  <CantidadEnFormulario
                    id="cantidadProducida"
                    name="cantidadProducida"
                    simbolo={datos.droga.unidadBaseSimbolo}
                    valor={cantidadProducida}
                    onChange={setProducidaEditada}
                    required
                    pendiente={producidaPendiente}
                  />
                </div>
              </div>
              <p className={`text-right text-xs ${producidaPendiente ? "text-red-600" : "text-zinc-500"}`}>
                {sumaDistinta ? (
                  <>
                    Lo usado suma {formatNumero(suma)} {simboloProducido}.{" "}
                    <button type="button" onClick={() => setProducidaEditada(null)} className="underline">
                      Usar la suma
                    </button>
                  </>
                ) : suma !== null ? (
                  "La suma de lo usado. Corregila si hubo pérdida."
                ) : consumos.length > 0 ? (
                  `Lo usado está en distintas unidades (${unidadesUsadas.join(" y ")}): indicá el total del lote obtenido.`
                ) : (
                  "Se completa con la suma de lo usado."
                )}
              </p>
            </div>
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

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="nombre" className="field-label">
                Nombre en la etiqueta
              </label>
              <input
                id="nombre"
                name="nombre"
                value={nombre}
                onChange={(e) => setNombreEditado(e.target.value)}
                maxLength={NOMBRE_LOTE_MAX}
                required
                autoComplete="off"
                className="input"
              />
              <p className="field-help">
                {nombreEditado !== null ? (
                  <button type="button" onClick={() => setNombreEditado(null)} className="underline">
                    Usar el sugerido
                  </button>
                ) : tipo === "DILUCION" ? (
                  "Sugerido con la proporción de la dilución. Podés cambiarlo."
                ) : (
                  "Sugerido con el nombre de la droga. Podés cambiarlo."
                )}
              </p>
            </div>
            <div className="field">
              <label htmlFor="aspecto" className="field-label">
                Aspecto <span className="font-normal text-zinc-400">(opcional)</span>
              </label>
              <input id="aspecto" name="aspecto" maxLength={NOMBRE_LOTE_MAX} placeholder="Crema blanca" autoComplete="off" className="input" />
            </div>
          </div>

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
          {porFormula ? <span className="ml-2 font-normal text-zinc-500">({textoEnFormulario(porFormula, simbolo)} por fórmula)</span> : null}
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
                Usar ({simboloEnFormulario(simbolo)})
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
                    {textoEnFormulario(p.cantidadDisponible, p.unidadBaseSimbolo)}
                    <EnGramos valor={aUnidadDeFormulario(p.cantidadDisponible, p.unidadBaseSimbolo).toFixed()} simbolo={p.unidadBaseSimbolo} />
                  </td>
                  <td className="px-3 py-1.5 text-right align-top">
                    <CantidadEnFormulario
                      id={id}
                      name={id}
                      simbolo={p.unidadBaseSimbolo}
                      valor={cantidades[p.id] ?? ""}
                      onChange={(valor) => onCantidad(p.id, valor)}
                      enfocar={enfocar.current === p.id ? () => (enfocar.current = null) : undefined}
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

/** The grams in grey under a mass shown in mg (nothing for another unit). */
function EnGramos({ valor, simbolo }: { valor: string | null; simbolo: string }) {
  const texto = enGramos(valor, simbolo);
  return texto ? <span className="block text-xs font-normal text-zinc-500">{texto}</span> : null;
}

/**
 * A quantity typed in the form's unit (mg for a mass), its grams in grey below, submitted in the droga's unidad base
 * through a hidden input named `name`. A server error on that name marks the visible input (FIELD_ERROR_EVENT, same
 * contract as shared/ui/date-input.tsx); `pendiente` keeps it red while it is still to be filled.
 */
function CantidadEnFormulario({
  id,
  name,
  simbolo,
  valor,
  onChange,
  required = false,
  pendiente = false,
  enfocar,
}: {
  id: string;
  name: string;
  /** The droga's unidad base. */
  simbolo: string;
  /** As typed, in the form's unit. */
  valor: string;
  onChange: (valor: string) => void;
  required?: boolean;
  pendiente?: boolean;
  /** Focus this input once mounted (a partida's "Diluir"); called when it does. */
  enfocar?: () => void;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const visibleRef = useRef<HTMLInputElement>(null);
  const [errorDelServidor, setErrorDelServidor] = useState(false);

  useEffect(() => {
    const hidden = hiddenRef.current;
    if (!hidden) return;
    function onFieldError(event: Event) {
      const detail = (event as CustomEvent<FieldErrorEventDetail>).detail;
      event.preventDefault();
      detail.focusTarget = visibleRef.current;
      setErrorDelServidor(detail.invalid);
    }
    hidden.addEventListener(FIELD_ERROR_EVENT, onFieldError);
    return () => hidden.removeEventListener(FIELD_ERROR_EVENT, onFieldError);
  }, []);

  useEffect(() => {
    if (!enfocar) return;
    visibleRef.current?.focus();
    enfocar();
  }, [enfocar]);

  const valido = cantidadValida(valor);
  return (
    <>
      <input
        id={id}
        ref={visibleRef}
        value={valor}
        onChange={(e) => {
          setErrorDelServidor(false);
          onChange(e.target.value);
        }}
        required={required}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={errorDelServidor || pendiente || undefined}
        className="input w-28 text-right font-mono"
      />
      {/* An unreadable value goes as typed: the command refuses it on this field. */}
      <input ref={hiddenRef} type="hidden" name={name} value={valido ? aUnidadBase(valido, simbolo).toFixed() : valor} />
      <EnGramos valor={valido} simbolo={simbolo} />
    </>
  );
}
