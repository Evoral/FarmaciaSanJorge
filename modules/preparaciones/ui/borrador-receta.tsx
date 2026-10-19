"use client";

/**
 * The receta draft of the toma workspace (/preparaciones/recetas/[recetaId])
 * shared between its edit form and its fichas técnicas -- the page is a
 * Server Component, so it cannot hand a callback from one to the other.
 *
 * `RecetaFormToma` renders the receta edit form with a fixed header and
 * publishes its draft (`onBorradorChange`) to `BorradorRecetaProvider`,
 * which computes the live preview of every unsaved ítem's ficha
 * (`previsualizarFichasAction`, `preparaciones.toma.previsualizarFichas`):
 * ~600 ms after the draft stops changing, only for the changed and new
 * ítems complete enough to compute (recetas' `itemsListosParaPresupuesto`),
 * a response that arrives after a newer request was sent is ignored -- the
 * same pattern as modules/recetas/ui/presupuesto-panel.tsx. Each preview is
 * kept with the ítem it was computed for, so it stays visible (marked as
 * updating) until the next one arrives. ./fichas-borrador.tsx reads it.
 *
 * Without a provider, or before the form published anything, there is no
 * draft (`useBorradorReceta()` is `null`): the page shows what is saved.
 *
 * The form lives in a collapsible (`EdicionRecetaDesplegable`), closed by
 * default -- with the fichas generated automatically, correcting a receta here
 * is the exception. Closing it only hides the form: it stays mounted, so an
 * unsaved draft (and its previews) survives; the summary flags it. While it
 * is closed each ítem card shows the ítem's saved data
 * (`SoloConEdicionCerrada`), which the open form would duplicate.
 */
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { ToneBadge } from "@/shared/ui/status-badge";
import { RecetaForm } from "@/modules/recetas/ui/receta-form";
import type { BorradorReceta, ItemRecetaBorrador, RecetaFormInicial, RecetaFormProps } from "@/modules/recetas/ui/receta-form";
import { itemsListosParaPresupuesto } from "@/modules/recetas/domain/presupuesto";
import type { FichaPrevista } from "../application/previsualizar-fichas";
import { previsualizarFichasAction } from "./actions";
import type { VistaPreviaFichasState } from "./action-state";

const DEBOUNCE_MS = 600;

/** The preview of one draft ítem's ficha. */
export type VistaPreviaFicha =
  /** The ítem still lacks a droga, a unidad or a cantidad: nothing is sent. */
  | { estado: "incompleto" }
  /** Waiting for the first answer for this ítem. */
  | { estado: "calculando" }
  /** `actualizando`: the ítem changed after this answer was computed; a new one is on its way. */
  | { estado: "lista"; ficha: FichaPrevista; actualizando: boolean };

export interface BorradorRecetaContexto {
  borrador: BorradorReceta;
  /** The preview of the draft's ítem at `indice` (0-based, draft order). */
  vistaPrevia: (indice: number) => VistaPreviaFicha;
}

const BorradorContext = createContext<BorradorRecetaContexto | null>(null);
const PublicarContext = createContext<((borrador: BorradorReceta) => void) | null>(null);
const EdicionAbiertaContext = createContext<{ abierta: boolean; setAbierta: (abierta: boolean) => void } | null>(null);

/** The workspace's draft and its previews; `null` when there is no edit form (or it did not publish yet). */
export function useBorradorReceta(): BorradorRecetaContexto | null {
  return useContext(BorradorContext);
}

/** A draft ítem's key: its id when saved, its position when new. */
function claveDe(item: ItemRecetaBorrador, indice: number): string {
  return item.id ?? `nuevo-${indice}`;
}

function esListo(item: ItemRecetaBorrador): boolean {
  return itemsListosParaPresupuesto([item]);
}

interface PedidoItem {
  clave: string;
  item: ItemRecetaBorrador;
}

export function BorradorRecetaProvider({ children }: { children: ReactNode }) {
  const [borrador, setBorrador] = useState<BorradorReceta | null>(null);
  // The last answer per ítem key, with the ítem (serialized) it was computed for.
  const [previas, setPrevias] = useState<Record<string, { json: string; ficha: FichaPrevista }>>({});
  const ultimaSolicitud = useRef(0);
  const [abierta, setAbierta] = useState(false);
  const edicion = useMemo(() => ({ abierta, setAbierta }), [abierta]);

  // Only the unsaved ítems -- changed or new -- that are complete enough get a preview.
  const pedidoJson = useMemo(() => {
    if (!borrador?.sinGuardar) return JSON.stringify([]);
    const pedido: PedidoItem[] = borrador.items.flatMap((item, indice) =>
      (!item.id || borrador.itemsModificados.includes(item.id)) && esListo(item) ? [{ clave: claveDe(item, indice), item }] : [],
    );
    return JSON.stringify(pedido);
  }, [borrador]);

  const calcular = useCallback(async (json: string) => {
    const solicitud = ++ultimaSolicitud.current;
    const pedido = JSON.parse(json) as PedidoItem[];
    let respuesta: VistaPreviaFichasState;
    try {
      respuesta = await previsualizarFichasAction(JSON.stringify(pedido.map((p) => p.item)));
    } catch {
      respuesta = { status: "error", message: "No se pudo calcular la vista previa de la ficha técnica." };
    }
    // A newer request was sent meanwhile: this answer is stale.
    if (solicitud !== ultimaSolicitud.current) return;
    setPrevias((anteriores) => {
      const siguientes = { ...anteriores };
      pedido.forEach((p, i) => {
        const ficha: FichaPrevista =
          respuesta.status === "success"
            ? (respuesta.fichas[i] ?? { ok: false, mensaje: "No se pudo calcular la vista previa de la ficha técnica." })
            : { ok: false, mensaje: respuesta.message };
        siguientes[p.clave] = { json: JSON.stringify(p.item), ficha };
      });
      return siguientes;
    });
  }, []);

  useEffect(() => {
    if (pedidoJson === "[]") {
      // Invalidate any request still in flight: its ítems are no longer the form's.
      ultimaSolicitud.current++;
      return;
    }
    const timer = setTimeout(() => void calcular(pedidoJson), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [pedidoJson, calcular]);

  const contexto = useMemo<BorradorRecetaContexto | null>(() => {
    if (!borrador) return null;
    return {
      borrador,
      vistaPrevia: (indice) => {
        const item = borrador.items[indice];
        if (!item || !esListo(item)) return { estado: "incompleto" };
        const previa = previas[claveDe(item, indice)];
        if (!previa) return { estado: "calculando" };
        return { estado: "lista", ficha: previa.ficha, actualizando: previa.json !== JSON.stringify(item) };
      },
    };
  }, [borrador, previas]);

  return (
    <PublicarContext.Provider value={setBorrador}>
      <BorradorContext.Provider value={contexto}>
        <EdicionAbiertaContext.Provider value={edicion}>{children}</EdicionAbiertaContext.Provider>
      </BorradorContext.Provider>
    </PublicarContext.Provider>
  );
}

export interface RecetaFormTomaProps {
  recetaId: string;
  unidades: RecetaFormProps["unidades"];
  inicial: RecetaFormInicial;
  /** Where the form comes back after saving (this workspace). */
  volverA: string;
}

/** The receta edit form of the workspace: ítems only (the header is shown read-only above it), its draft published to `BorradorRecetaProvider`. */
export function RecetaFormToma({ recetaId, unidades, inicial, volverA }: RecetaFormTomaProps) {
  const publicar = useContext(PublicarContext);
  return <RecetaForm mode="editar" unidades={unidades} disabled={false} recetaId={recetaId} inicial={inicial} volverA={volverA} encabezadoFijo onBorradorChange={publicar ?? undefined} />;
}

/** The edit form's collapsible: closed by default; `children` stay mounted while closed (the draft is kept). */
export function EdicionRecetaDesplegable({ children }: { children: ReactNode }) {
  const edicion = useContext(EdicionAbiertaContext);
  const [abiertaLocal, setAbiertaLocal] = useState(false);
  const abierta = edicion?.abierta ?? abiertaLocal;
  const setAbierta = edicion?.setAbierta ?? setAbiertaLocal;
  const sinGuardar = useBorradorReceta()?.borrador.sinGuardar ?? false;
  const contenidoId = useId();

  return (
    <section aria-label="Editar receta">
      <button
        type="button"
        aria-expanded={abierta}
        aria-controls={contenidoId}
        onClick={() => setAbierta(!abierta)}
        className="panel flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-zinc-50"
      >
        <ChevronRight aria-hidden className={`size-4 shrink-0 text-zinc-500 transition-transform duration-(--duration-base) ease-(--ease-out-expo) ${abierta ? "rotate-90" : ""}`} />
        <Pencil aria-hidden className="size-4 shrink-0 text-zinc-500" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-900">Editar receta / agregar ítem</span>
          <span className="block text-xs text-zinc-500">Solo para corregir la receta: las fichas técnicas se regeneran al guardar.</span>
        </span>
        {sinGuardar ? <ToneBadge tone="warn">Cambios sin guardar</ToneBadge> : null}
      </button>
      <div id={contenidoId} hidden={!abierta} className="mt-4">
        {children}
      </div>
    </section>
  );
}

/** Renders `children` only while the edit form is closed (or there is no edit form). */
export function SoloConEdicionCerrada({ children }: { children: ReactNode }) {
  const edicion = useContext(EdicionAbiertaContext);
  return edicion?.abierta ? null : <>{children}</>;
}
