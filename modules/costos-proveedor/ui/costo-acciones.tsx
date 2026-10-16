"use client";

/**
 * Row actions of the "Vigentes" list (`ActionMenu`): Historial for whoever can read the list,
 * and -- with `costos.proveedor.gestionar` -- Editar (the manual form prefilled from this
 * pair) and Dar de baja (R11). The baja asks for a required motivo in a native `<dialog>`
 * (same pattern as modules/preparaciones/ui/reserva-acciones.tsx); the use case checks the
 * permiso again and refuses a costo that stopped being vigente meanwhile (R23).
 */
import { useEffect, useId, useRef, useState } from "react";
import { History, Pencil, Trash2, X } from "lucide-react";
import { ActionMenu, type ActionMenuItem } from "@/shared/ui/action-menu";
import { MotivoField } from "@/shared/ui/motivo-form";
import { SimpleForm } from "@/shared/ui/simple-form";
import { toast } from "@/shared/ui/toast";
import type { CostoProveedorActionState } from "./action-state";
import { darDeBajaCostoProveedorAction } from "./actions";

/**
 * The toast is raised when the action resolves, NOT from the form's `onSuccess`: the action's `revalidatePath`
 * re-renders the list in the same response and the baja'd row (and this form with it) is gone before any success
 * effect would run. The Toaster lives in the route's layout, so it survives that re-render.
 */
async function darDeBajaConAviso(estadoPrevio: CostoProveedorActionState, formData: FormData): Promise<CostoProveedorActionState> {
  const estado = await darDeBajaCostoProveedorAction(estadoPrevio, formData);
  if (estado.status === "success" && estado.message) toast(estado.message);
  return estado;
}

export interface CostoAccionesProps {
  costoId: string;
  drogaId: string;
  proveedorId: string;
  /** "Droga · Proveedor", for the menu's accessible name and the dialog. */
  etiqueta: string;
  puedeGestionar: boolean;
}

export function CostoAcciones({ costoId, drogaId, proveedorId, etiqueta, puedeGestionar }: CostoAccionesProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const tituloId = useId();
  // Bumped on every closing: the next opening starts with an empty motivo.
  const [apertura, setApertura] = useState(0);
  // The menu item only asks to open; the effect talks to the native dialog (a ref is never read while rendering).
  const [abierto, setAbierto] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (abierto && dialog && !dialog.open) dialog.showModal();
  }, [abierto]);

  const par = new URLSearchParams({ droga: drogaId, proveedor: proveedorId }).toString();
  const items: ActionMenuItem[] = [{ kind: "link", label: "Historial", href: `/costos-proveedor/historial?${par}`, icon: History }];
  if (puedeGestionar) {
    items.unshift({ kind: "link", label: "Editar", href: `/costos-proveedor/nuevo?${par}`, icon: Pencil });
    items.push({ kind: "separator" }, { kind: "action", label: "Dar de baja", tone: "danger", icon: Trash2, onSelect: () => setAbierto(true) });
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <ActionMenu label={`Acciones del costo de ${etiqueta}`} items={items} />
      {puedeGestionar ? (
        <dialog
          ref={dialogRef}
          aria-labelledby={tituloId}
          onClose={() => {
            setAbierto(false);
            setApertura((n) => n + 1);
          }}
          className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-md p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
        >
          <div className="flex flex-col gap-4 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id={tituloId} className="text-lg font-semibold">
                  Dar de baja el costo
                </h2>
                <p className="truncate text-sm text-zinc-500">{etiqueta}</p>
              </div>
              <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <p className="text-sm text-zinc-600">
              La droga queda sin costo de este proveedor y las cotizaciones nuevas dejan de usarlo. El historial se conserva y se puede cargar otro precio cuando haga falta.
            </p>
            <SimpleForm
              key={apertura}
              action={darDeBajaConAviso}
              submitLabel="Dar de baja"
              pendingLabel="Dando de baja…"
              submitVariant="danger-solid"
              extraActions={
                <button type="button" onClick={cerrar} className="btn btn-secondary">
                  Cancelar
                </button>
              }
              onSuccess={cerrar}
            >
              <input type="hidden" name="costoProveedorId" value={costoId} />
              <MotivoField />
            </SimpleForm>
          </div>
        </dialog>
      ) : null}
    </>
  );
}
