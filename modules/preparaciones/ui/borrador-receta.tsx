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
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
      <BorradorContext.Provider value={contexto}>{children}</BorradorContext.Provider>
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
