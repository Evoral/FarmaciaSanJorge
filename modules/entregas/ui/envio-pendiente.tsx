"use client";

/**
 * What the entrega panel shows for an envío waiting for its firma (ENVIADA_PEND_FIRMA, docs/specs/envios-repartidores.md):
 * the domicilio it goes to, its repartidor (nombre, apellido, teléfono) or "Sin repartidor asignado" for an envío
 * registered before migration 0093 (E7), and -- for whoever can register entregas -- the button that opens the
 * repartidor autocomplete (E5): "Cambiar repartidor", or "Asignar repartidor" when there is none.
 */
import { useState } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { formatearNombreRepartidor } from "@/modules/repartidores/domain/repartidor";
import type { EntregaActionState } from "./action-state";
import { CambiarRepartidorForm } from "./cambiar-repartidor-form";

export interface RepartidorAsignado {
  id: string;
  nombre: string;
  apellido: string;
  telefono: string;
}

export interface EnvioPendienteProps {
  recetaId: string;
  domicilioPaciente: string | null;
  repartidor: RepartidorAsignado | null;
  /** `entregas.registrar`: may change the repartidor. */
  puedeCambiar: boolean;
  /** The tenant has at least one active repartidor to pick. */
  hayRepartidoresActivos: boolean;
  /** `repartidores.gestionar`: the "No hay repartidores" notice links to the catalog only for who can open it. */
  puedeGestionarRepartidores: boolean;
  cambiarAction: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
}

export function EnvioPendiente({
  recetaId,
  domicilioPaciente,
  repartidor,
  puedeCambiar,
  hayRepartidoresActivos,
  puedeGestionarRepartidores,
  cambiarAction,
}: EnvioPendienteProps) {
  const [editando, setEditando] = useState(false);
  const domicilio = domicilioPaciente?.trim() ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="field">
        <span className="field-label">Domicilio de entrega</span>
        <p className="text-sm text-zinc-900">{domicilio || <span className="text-zinc-400">Sin domicilio cargado</span>}</p>
      </div>

      <div className="field">
        <span className="field-label">Repartidor</span>
        {repartidor ? (
          <p className="text-sm text-zinc-900">
            {formatearNombreRepartidor(repartidor)} <span className="text-zinc-500">· {repartidor.telefono}</span>
          </p>
        ) : (
          <p className="text-sm text-zinc-500">Sin repartidor asignado</p>
        )}
      </div>

      {puedeCambiar && !editando ? (
        hayRepartidoresActivos ? (
          <div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditando(true)}>
              {repartidor ? "Cambiar repartidor" : "Asignar repartidor"}
            </button>
          </div>
        ) : (
          <div role="note" className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <p>
              <strong className="font-semibold">No hay repartidores cargados.</strong>{" "}
              {puedeGestionarRepartidores ? (
                <>
                  Cargue uno en{" "}
                  <Link href="/catalogos/repartidores" className="font-medium text-primary underline">
                    Catálogos → Repartidores
                  </Link>
                  .
                </>
              ) : (
                "Pida a un administrador que cargue uno."
              )}
            </p>
          </div>
        )
      ) : null}

      {puedeCambiar && editando ? (
        <CambiarRepartidorForm
          action={cambiarAction}
          recetaId={recetaId}
          repartidorActualId={repartidor?.id ?? null}
          asignacion={repartidor === null}
          onSuccess={() => setEditando(false)}
          onCancel={() => setEditando(false)}
        />
      ) : null}
    </div>
  );
}
