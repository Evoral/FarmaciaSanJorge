"use client";

/**
 * `/archivo/[id]` destrucción actions (FASE 12 point 12.3, user decision
 * 5). Only ONE of these renders at a time -- the caller passes the single
 * flag that matches the lote's current estado (`puedeSolicitarDestruccion`
 * / `puedeAutorizarDestruccion` / `puedeRegistrarDestruccion`, computed
 * server-side by `application/list-lotes.ts`). Every step requires the
 * DT's OWN FULL PASSWORD -- the PIN is never accepted here.
 */
import { useState } from "react";
import { solicitarDestruccionAction, autorizarDestruccionAction, registrarDestruccionAction } from "./actions";
import { SimpleForm } from "./simple-form";

function PasswordField() {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="password" className="text-sm font-medium">
        Tu contraseña
      </label>
      <input id="password" name="password" type="password" autoComplete="off" required className="input" />
      <p className="text-xs text-zinc-500">Se requiere tu contraseña completa. El PIN no es válido para este trámite.</p>
    </div>
  );
}

export function SolicitarDestruccionForm({ loteId }: { loteId: string }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Solicitar destrucción</h3>
      <p className="mb-3 text-sm text-zinc-600 dark:text-zinc-400">El plazo de conservación de este lote está cumplido. Se destruyen solo las recetas en papel; los registros digitales se conservan.</p>
      <SimpleForm action={solicitarDestruccionAction} submitLabel="Solicitar destrucción" pendingLabel="Solicitando…" className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="id" value={loteId} />
        <PasswordField />
      </SimpleForm>
    </div>
  );
}

export function AutorizarDestruccionForm({ loteId }: { loteId: string }) {
  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Autorizar destrucción</h3>
      <SimpleForm action={autorizarDestruccionAction} submitLabel="Autorizar destrucción" pendingLabel="Autorizando…" className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="id" value={loteId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="expedienteAutorizacion" className="text-sm font-medium">
            Número de expediente
          </label>
          <input id="expedienteAutorizacion" name="expedienteAutorizacion" type="text" required className="input" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaAutorizacion" className="text-sm font-medium">
            Fecha de autorización
          </label>
          <input id="fechaAutorizacion" name="fechaAutorizacion" type="date" required className="input" />
        </div>
        <PasswordField />
      </SimpleForm>
    </div>
  );
}

export function RegistrarDestruccionForm({ loteId }: { loteId: string }) {
  const [confirma, setConfirma] = useState(false);

  return (
    <div className="card p-4">
      <h3 className="mb-2 text-sm font-semibold">Registrar destrucción</h3>
      <div className="mb-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        <p className="mb-2">Se destruyen solo las recetas en papel de este lote. Los registros digitales (recetas, asientos, adjuntos) se conservan sin cambios y esta acción no se puede revertir.</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} />
          Confirmo que las recetas en papel de este lote fueron destruidas.
        </label>
      </div>
      <SimpleForm action={registrarDestruccionAction} submitLabel="Registrar destrucción" pendingLabel="Registrando…" submitDisabled={!confirma} className="flex max-w-lg flex-col gap-4">
        <input type="hidden" name="id" value={loteId} />
        <div className="flex flex-col gap-1">
          <label htmlFor="fechaDestruccion" className="text-sm font-medium">
            Fecha de destrucción
          </label>
          <input id="fechaDestruccion" name="fechaDestruccion" type="date" required className="input" />
        </div>
        <PasswordField />
      </SimpleForm>
    </div>
  );
}
