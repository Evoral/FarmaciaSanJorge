"use client";

/**
 * The fichas técnicas of the toma workspace (/preparaciones/recetas/[recetaId])
 * follow its edit form's draft (./borrador-receta.tsx). The page renders
 * each saved ítem's ficha and actions on the server and wraps them here:
 *
 * - No unsaved change -> exactly what the server rendered (`children`).
 * - The ítem changed -> a warning and the LIVE preview of its ficha (what
 *   saving will generate); removed from the draft -> a warning that saving
 *   removes it. Ítems added in the draft get their own preview cards
 *   (`FichasDeItemsNuevos`).
 * - Any unsaved change -> no ítem can start its confirmation
 *   (`RequiereRecetaGuardada`): starting a preparación locks the receta and
 *   the unsaved edits would be lost.
 *
 * Without a draft (no edit form) everything renders as the server sent it.
 */
import type { ReactNode } from "react";
import { Lock, TriangleAlert } from "lucide-react";
import { FORMA_FARMACEUTICA_LABELS } from "@/shared/labels/enum-labels";
import { ToneBadge } from "@/shared/ui/status-badge";
import { useBorradorReceta } from "./borrador-receta";
import type { VistaPreviaFicha } from "./borrador-receta";
import { LineasFichaTabla } from "./lineas-ficha-tabla";

function Aviso({ children }: { children: ReactNode }) {
  return (
    <div className="alert alert-warn mb-3">
      <TriangleAlert aria-hidden />
      <p>{children}</p>
    </div>
  );
}

function TituloFicha() {
  return <h4 className="mb-3 text-sm font-semibold text-zinc-900">Ficha técnica</h4>;
}

/** What saving would generate for one draft ítem. */
function VistaPrevia({ vista }: { vista: VistaPreviaFicha }) {
  return (
    <div aria-live="polite" className="flex flex-col gap-2">
      {vista.estado === "incompleto" ? (
        <p className="text-sm text-zinc-500">Completá la droga, la unidad y la cantidad de cada componente para ver la ficha técnica.</p>
      ) : vista.estado === "calculando" ? (
        <p className="text-sm text-zinc-500">Calculando la vista previa…</p>
      ) : (
        <>
          {vista.actualizando ? <p className="text-xs text-zinc-500">Actualizando con los últimos cambios…</p> : null}
          {!vista.ficha.ok ? (
            <p role="alert" className="text-sm text-red-600">
              {vista.ficha.mensaje}
            </p>
          ) : vista.ficha.lineas.length === 0 ? (
            <p className="text-sm text-zinc-500">La ficha técnica no tendría líneas de pesaje.</p>
          ) : (
            <LineasFichaTabla lineas={vista.ficha.lineas} />
          )}
        </>
      )}
    </div>
  );
}

/** A saved ítem's ficha técnica block: the server-rendered ficha (`children`), or the warning/preview when the draft changed or removed the ítem. */
export function FichaTecnicaEnToma({ itemId, children }: { itemId: string; children: ReactNode }) {
  const contexto = useBorradorReceta();
  if (!contexto?.borrador.sinGuardar) return children;

  const indice = contexto.borrador.items.findIndex((item) => item.id === itemId);
  if (indice < 0) {
    return (
      <>
        <TituloFicha />
        <Aviso>Este ítem se quitó del formulario: se elimina de la receta al guardar los cambios.</Aviso>
      </>
    );
  }
  if (!contexto.borrador.itemsModificados.includes(itemId)) return children;

  return (
    <>
      <TituloFicha />
      <Aviso>Hay cambios sin guardar en este ítem: esta es una vista previa. La ficha técnica se genera al guardar.</Aviso>
      <VistaPrevia vista={contexto.vistaPrevia(indice)} />
    </>
  );
}

const NOTA_GUARDAR = (
  <p className="mr-auto flex items-start gap-2 text-sm text-zinc-600">
    <Lock className="mt-0.5 size-3.5 flex-none" aria-hidden />
    Guardá los cambios de la receta para poder confirmar la terminación.
  </p>
);

/** `children` (an action that needs the receta as saved) only while the draft has no unsaved change; otherwise `nota`. */
export function RequiereRecetaGuardada({ children, nota = NOTA_GUARDAR }: { children: ReactNode; nota?: ReactNode }) {
  const contexto = useBorradorReceta();
  return contexto?.borrador.sinGuardar ? nota : children;
}

/** Preview cards for the ítems added in the draft (not saved yet), after the saved ones. */
export function FichasDeItemsNuevos() {
  const contexto = useBorradorReceta();
  if (!contexto?.borrador.sinGuardar) return null;
  const nuevos = contexto.borrador.items.flatMap((item, indice) => (item.id ? [] : [{ item, indice }]));

  return nuevos.map(({ item, indice }) => {
    const headingId = `item-toma-nuevo-${indice}`;
    return (
      <article key={indice} className="group-card" aria-labelledby={headingId}>
        <div className="group-card-header">
          <span className="index-badge" aria-hidden>
            {indice + 1}
          </span>
          <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
            <span className="sr-only">Ítem nuevo {indice + 1}: </span>
            {item.descripcion ?? FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]}
          </h3>
          <ToneBadge tone="warn">Nuevo, sin guardar</ToneBadge>
        </div>

        <div className="p-4 sm:p-5">
          <TituloFicha />
          <Aviso>Ítem nuevo sin guardar: esta es una vista previa. La ficha técnica se genera al guardar.</Aviso>
          <VistaPrevia vista={contexto.vistaPrevia(indice)} />
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100 bg-zinc-50/60 px-4 py-3 sm:px-5">{NOTA_GUARDAR}</div>
      </article>
    );
  });
}
