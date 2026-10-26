"use client";

/**
 * "Importar lista" (/costos-proveedor/importar, openspec/specs/costos-proveedor/spec.md R13): two steps in one screen.
 *
 *   1. proveedor (autocomplete), fecha de la lista and the .xls or .xlsx file. Reading starts as soon as a file is picked
 *      (same interaction as the invoice import, modules/stock/ui/importar-factura-pdf.tsx): the file is sent to
 *      `leerListaPreciosAction`, read in memory and discarded -- NOTHING is saved. The size pre-check is only for a
 *      clearer message (the server validates the file again, R15).
 *   2. the editable preview (`ImportarListaForm`), with a sheet selector: the workbook has one sheet per date; the
 *      LAST one with data is opened, and choosing another re-reads the SAME file (kept here) with that sheet.
 *
 * Proveedor and fecha are fixed once the file is read (the preview was compared against that proveedor and dated with
 * that fecha): to change them, "Elegir otro archivo" starts over. A failed re-read keeps the preview in view.
 */
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { CircleAlert, FileSpreadsheet, Upload, X } from "lucide-react";
import { Combobox, filtrarOpciones, type ComboboxOption } from "@/shared/ui/combobox";
import { DateInput } from "@/shared/ui/date-input";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { formatFechaIso } from "@/shared/format/fecha";
import { MAX_LISTA_BYTES, MENSAJES_ARCHIVO_LISTA } from "../domain/archivo-lista";
import type { VistaPreviaLista } from "../domain/importacion-lista";
import { IDLE_LEER_LISTA_STATE } from "./action-state";
import { leerListaPreciosAction } from "./actions";
import type { DrogaOpcionCosto, UnidadOpcionCosto } from "./costo-form";
import { ImportarListaForm } from "./importar-lista-form";
import type { UnidadOpcion } from "@/modules/drogas/ui/droga-form";

export interface ImportarListaProps {
  proveedores: readonly { id: string; razonSocial: string }[];
  drogas: readonly DrogaOpcionCosto[];
  unidades: readonly UnidadOpcionCosto[];
  /** `YYYY-MM-DD`: the pharmacy's today (default and maximum of the list's date). */
  jornadaActual: string;
  /** Units for the "Nuevo insumo" alta of a "sin asociar" row; `null` without `drogas.crear`. */
  unidadesAltaDroga: UnidadOpcion[] | null;
  /** For that alta: the contralor digital is activo. */
  contralorActivo?: boolean;
}

/** Starting over remounts the step (a fresh `useActionState`, no stale error). */
export function ImportarLista(props: ImportarListaProps) {
  const [intento, setIntento] = useState(0);
  return <ImportarListaPaso key={intento} {...props} onReiniciar={() => setIntento((n) => n + 1)} />;
}

function ImportarListaPaso({ proveedores, drogas, unidades, jornadaActual, unidadesAltaDroga, contralorActivo, onReiniciar }: ImportarListaProps & { onReiniciar: () => void }) {
  const router = useRouter();
  const [state, formAction, isPending] = useActionState(leerListaPreciosAction, IDLE_LEER_LISTA_STATE);
  const { onSubmit } = useFormSubmit(formAction);
  const buscarProveedores = useMemo(() => filtrarOpciones(proveedores.map((p) => ({ value: p.id, label: p.razonSocial }))), [proveedores]);

  const [proveedor, setProveedor] = useState<ComboboxOption | null>(null);
  const [fecha, setFecha] = useState(jornadaActual);
  const [errorCliente, setErrorCliente] = useState<string | null>(null);
  const [vista, setVista] = useState<VistaPreviaLista | null>(null);
  /** The file picked, kept so another sheet can be read from it. */
  const archivo = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  // Each result of the read opens (or replaces) the preview; an error keeps whatever is already in view.
  const [resultadoVisto, setResultadoVisto] = useState(state);
  if (state !== resultadoVisto) {
    setResultadoVisto(state);
    if (state.status === "success") setVista(state.vista);
  }

  useEffect(() => {
    // After an error the same file must be pickable again once fixed (a change event needs a different value).
    if (state.status === "error" && inputRef.current) inputRef.current.value = "";
  }, [state]);

  function elegirArchivo(evento: ChangeEvent<HTMLInputElement>) {
    const elegido = evento.target.files?.[0];
    if (!elegido) return;
    const rechazo = elegido.size > MAX_LISTA_BYTES ? MENSAJES_ARCHIVO_LISTA.demasiadoGrande : !proveedor ? "Elegí el proveedor antes de seleccionar el archivo." : !fecha ? "Indicá la fecha de la lista antes de seleccionar el archivo." : null;
    if (rechazo) {
      setErrorCliente(rechazo);
      evento.target.value = "";
      return;
    }
    setErrorCliente(null);
    archivo.current = elegido;
    evento.target.form?.requestSubmit();
  }

  /** Same file, another sheet: the proveedor and fecha are the ones the preview was read with. */
  function leerHoja(hoja: string) {
    if (!vista || !archivo.current) return;
    const datos = new FormData();
    datos.set("proveedorId", vista.proveedor.id);
    datos.set("fechaLista", vista.fechaLista);
    datos.set("archivo", archivo.current);
    datos.set("hoja", hoja);
    startTransition(() => formAction(datos));
  }

  const mensajeError = errorCliente ?? (state.status === "error" ? state.message : null);
  const alerta = mensajeError ? (
    <div role="alert" className="alert alert-danger">
      <CircleAlert aria-hidden />
      <p>{mensajeError}</p>
    </div>
  ) : null;

  if (vista) {
    return (
      <div className="flex flex-col gap-5">
        <section aria-label="Archivo leído" className="panel">
          <div className="panel-body flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <dl className="grid flex-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-zinc-500">Proveedor</dt>
                <dd className="font-medium text-zinc-900">{vista.proveedor.razonSocial}</dd>
              </div>
              <div>
                <dt className="text-zinc-500">Fecha de la lista</dt>
                <dd className="font-medium text-zinc-900">{formatFechaIso(vista.fechaLista)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="text-zinc-500">Archivo</dt>
                <dd className="break-all font-medium text-zinc-900">{vista.nombreArchivo}</dd>
              </div>
              <div className="field">
                <label htmlFor={`${inputId}-hoja`} className="text-zinc-500">
                  Hoja
                </label>
                <select
                  id={`${inputId}-hoja`}
                  className="input input-sm"
                  value={vista.hoja}
                  disabled={isPending || vista.hojas.length < 2}
                  onChange={(e) => leerHoja(e.target.value)}
                >
                  {vista.hojas.map((hoja) => (
                    <option key={hoja.nombre} value={hoja.nombre} disabled={hoja.vacia}>
                      {hoja.vacia ? `${hoja.nombre} (vacía)` : hoja.nombre}
                    </option>
                  ))}
                </select>
              </div>
            </dl>
            <button type="button" onClick={onReiniciar} className="btn btn-ghost">
              <X className="size-4" aria-hidden />
              Elegir otro archivo
            </button>
          </div>
          <div className="px-4 pb-4 sm:px-5">
            <p role="status" className="text-[0.8125rem] text-zinc-500">
              {isPending ? "Leyendo la hoja…" : vista.hojas.length > 1 ? "Cambiar de hoja vuelve a leer el archivo y descarta los cambios hechos en esta pantalla." : " "}
            </p>
            {alerta}
          </div>
        </section>

        <ImportarListaForm key={`${vista.hashSha256}|${vista.hoja}`} vista={vista} drogas={drogas} unidades={unidades}
          unidadesAltaDroga={unidadesAltaDroga}
          contralorActivo={contralorActivo}
          onImportada={() => router.push("/costos-proveedor/listas")}
        />
      </div>
    );
  }

  return (
    <section aria-labelledby="importar-lista-heading" className="panel max-w-3xl">
      <form action={formAction} onSubmit={onSubmit} noValidate className="panel-body flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="tone-tile" data-tone="neutral" aria-hidden>
            <FileSpreadsheet />
          </span>
          <div className="min-w-0">
            <h2 id="importar-lista-heading" className="text-sm font-semibold text-zinc-900">
              Importá la lista de precios de un proveedor
            </h2>
            <p className="mt-0.5 text-[0.8125rem] text-zinc-500">
              Elegí el proveedor y la fecha de la lista, y seleccioná el archivo .xls o .xlsx. No se guarda nada hasta que confirmes, y el archivo no se almacena.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Combobox id="lista-proveedor" label="Proveedor" placeholder="Buscar proveedor" name="proveedorId" search={buscarProveedores} value={proveedor} onChange={setProveedor} disabled={isPending} />
          <div className="field">
            <label htmlFor="lista-fecha" className="field-label">
              Fecha de la lista
            </label>
            <DateInput id="lista-fecha" name="fechaLista" value={fecha} onValueChange={setFecha} max={jornadaActual} required disabled={isPending} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input id={inputId} ref={inputRef} name="archivo" type="file" accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" required disabled={isPending} onChange={elegirArchivo} className="peer sr-only" />
          <label
            htmlFor={inputId}
            aria-disabled={isPending || undefined}
            className="btn btn-secondary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[var(--color-brand)]"
          >
            {isPending ? <span className="spinner" aria-hidden /> : <Upload className="size-4" aria-hidden />}
            {isPending ? "Leyendo la lista…" : "Seleccionar archivo .xls o .xlsx"}
          </label>
          <p role="status" className="sr-only">
            {isPending ? "Leyendo la lista…" : ""}
          </p>
        </div>
        <p className="field-help -mt-2">Se aceptan planillas de Excel .xls (97-2003) y .xlsx. Máximo {MAX_LISTA_BYTES / (1024 * 1024)} MB.</p>

        {alerta}
      </form>
    </section>
  );
}
