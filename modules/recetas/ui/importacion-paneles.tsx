"use client";

/**
 * Presentational pieces of the receta form's `importar` mode
 * (docs/specs/importacion-receta-pdf.md): the receta's digital provenance,
 * the warnings list, and one panel per person (paciente/médico) showing
 * whether it will be created ("Nuevo") or already exists ("Existente",
 * with the empty fields the PDF will complete). The editable inputs a panel
 * needs (nombre/apellido to confirm, a missing matrícula) are passed in as
 * `children` by the form, which owns their state.
 */
import type { ReactNode } from "react";
import { ETIQUETAS_CAMPOS_IMPORTABLES, separarPorSeveridad } from "../domain/importacion-receta";
import type { AdvertenciaImportacion, CampoMedicoImportable, CampoPacienteImportable, VistaPreviaImportacion } from "../domain/importacion-receta";

export function ResumenImportacion({ vistaPrevia }: { vistaPrevia: VistaPreviaImportacion }) {
  const { borrador } = vistaPrevia;
  return (
    <p className="text-sm">
      Receta digital <strong>{borrador.emisor}</strong> Nº <strong>{borrador.nroRecetaEmisor}</strong>
      {borrador.urlVerificacion ? (
        <>
          {" "}
          (
          <a href={borrador.urlVerificacion} target="_blank" rel="noopener noreferrer" className="underline">
            verificar en el sitio del emisor
          </a>
          )
        </>
      ) : null}
      . Se registra como <strong>receta digital firmada</strong> (recibida) al confirmar.
    </p>
  );
}

/** Warnings to review (amber box) and, apart, plain information about the receta (neutral box: nothing to fix, nothing is stored). */
export function AdvertenciasImportacion({ advertencias }: { advertencias: readonly AdvertenciaImportacion[] }) {
  const { advertencias: avisos, informativas } = separarPorSeveridad(advertencias);
  if (avisos.length === 0 && informativas.length === 0) return null;
  return (
    <>
      {avisos.length > 0 ? (
        <section aria-labelledby="advertencias-importacion" className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <h2 id="advertencias-importacion" className="mb-1 font-medium">
            Advertencias ({avisos.length})
          </h2>
          <ul className="list-disc pl-5">
            {avisos.map((a, i) => (
              <li key={i}>{a.mensaje}</li>
            ))}
          </ul>
        </section>
      ) : null}
      {informativas.length > 0 ? (
        <section aria-labelledby="informacion-importacion" className="rounded border border-zinc-300 bg-zinc-50 p-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          <h2 id="informacion-importacion" className="mb-1 font-medium">
            Información de la receta (no se guarda)
          </h2>
          <ul className="list-disc pl-5">
            {informativas.map((a, i) => (
              <li key={i}>{a.mensaje}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Badge({ children, tono }: { children: ReactNode; tono: "nuevo" | "existente" | "baja" }) {
  const clases =
    tono === "nuevo"
      ? "border-sky-300 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950 dark:text-sky-300"
      : tono === "existente"
        ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
        : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-300";
  return <span className={`ml-2 rounded border px-2 py-0.5 text-xs font-normal ${clases}`}>{children}</span>;
}

export interface PanelPersonaProps {
  titulo: "Paciente" | "Médico";
  /** Existing row's display name, or `null` when it will be created. */
  existente: string | null;
  dadoDeBaja?: boolean;
  completar: readonly (CampoPacienteImportable | CampoMedicoImportable)[];
  /** Read-only data from the PDF, shown for a new person. */
  datos: ReadonlyArray<{ etiqueta: string; valor: string | null }>;
  children?: ReactNode;
}

export function PanelPersona({ titulo, existente, dadoDeBaja, completar, datos, children }: PanelPersonaProps) {
  return (
    <fieldset className="card p-4">
      <legend className="px-1 text-sm font-medium">
        {titulo}
        {existente === null ? <Badge tono="nuevo">Nuevo</Badge> : dadoDeBaja ? <Badge tono="baja">Dado de baja</Badge> : <Badge tono="existente">Existente</Badge>}
      </legend>
      {existente !== null ? (
        <p className="text-sm">
          <strong>{existente}</strong>
          {completar.length > 0 ? (
            <span className="text-zinc-600 dark:text-zinc-400"> · Se completarán: {completar.map((c) => ETIQUETAS_CAMPOS_IMPORTABLES[c]).join(", ")}</span>
          ) : (
            <span className="text-zinc-600 dark:text-zinc-400"> · Sin datos para completar</span>
          )}
        </p>
      ) : (
        <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
          Se dará de alta al confirmar
          {datos.some((d) => d.valor) ? ": " : "."}
          {datos
            .filter((d) => d.valor)
            .map((d) => `${d.etiqueta} ${d.valor}`)
            .join(" · ")}
        </p>
      )}
      {children}
    </fieldset>
  );
}
