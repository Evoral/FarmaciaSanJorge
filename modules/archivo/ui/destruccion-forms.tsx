"use client";

/**
 * `/archivo/[id]` destrucción actions (FASE 12 point 12.3, user decision
 * 5). Only ONE of these renders at a time -- the caller passes the single
 * flag that matches the lote's current estado (`puedeSolicitarDestruccion`
 * / `puedeAutorizarDestruccion` / `puedeRegistrarDestruccion`, computed
 * server-side by `application/list-lotes.ts`). Every step requires the
 * DT's OWN FULL PASSWORD -- the PIN is never accepted here.
 */
import { useState, type ReactNode } from "react";
import { TriangleAlert } from "lucide-react";
import { solicitarDestruccionAction, autorizarDestruccionAction, registrarDestruccionAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";

function PasswordField() {
  return (
    <div className="field">
      <label htmlFor="password" className="field-label">
        Tu contraseña
      </label>
      <input id="password" name="password" type="password" autoComplete="off" required aria-describedby="password-ayuda" className="input" />
      <p id="password-ayuda" className="field-help">
        Se requiere tu contraseña completa. El PIN no es válido para este trámite.
      </p>
    </div>
  );
}

/** The panel every destrucción step lives in; `danger` for the last, irreversible one. */
function PasoPanel({ id, titulo, tono, children }: { id: string; titulo: string; tono?: "danger"; children: ReactNode }) {
  return (
    <section className="panel" data-tone={tono} aria-labelledby={id}>
      <div className="panel-header">
        <h2 id={id}>{titulo}</h2>
      </div>
      <div className="panel-body flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SolicitarDestruccionForm({ loteId }: { loteId: string }) {
  return (
    <PasoPanel id="solicitar-destruccion-heading" titulo="Solicitar destrucción">
      <p className="text-[0.8125rem] leading-relaxed text-zinc-600">
        El plazo de conservación de este lote está cumplido. Se destruyen solo las recetas en papel; los registros digitales se conservan.
      </p>
      <SimpleForm action={solicitarDestruccionAction} submitLabel="Solicitar destrucción" pendingLabel="Solicitando…">
        <input type="hidden" name="id" value={loteId} />
        <PasswordField />
      </SimpleForm>
    </PasoPanel>
  );
}

export function AutorizarDestruccionForm({ loteId }: { loteId: string }) {
  return (
    <PasoPanel id="autorizar-destruccion-heading" titulo="Autorizar destrucción">
      <SimpleForm action={autorizarDestruccionAction} submitLabel="Autorizar destrucción" pendingLabel="Autorizando…">
        <input type="hidden" name="id" value={loteId} />
        <div className="field">
          <label htmlFor="expedienteAutorizacion" className="field-label">
            Número de expediente
          </label>
          <input id="expedienteAutorizacion" name="expedienteAutorizacion" type="text" required className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="fechaAutorizacion" className="field-label">
            Fecha de autorización
          </label>
          <DateInput id="fechaAutorizacion" name="fechaAutorizacion" required />
        </div>
        <PasswordField />
      </SimpleForm>
    </PasoPanel>
  );
}

export function RegistrarDestruccionForm({ loteId }: { loteId: string }) {
  const [confirma, setConfirma] = useState(false);

  return (
    <PasoPanel id="registrar-destruccion-heading" titulo="Registrar destrucción" tono="danger">
      <div className="alert alert-warn">
        <TriangleAlert aria-hidden />
        <div className="flex flex-col gap-2">
          <p>Se destruyen solo las recetas en papel de este lote. Los registros digitales (recetas, asientos, adjuntos) se conservan sin cambios y esta acción no se puede revertir.</p>
          <label className="flex items-start gap-2 font-medium">
            <input type="checkbox" className="mt-0.5" checked={confirma} onChange={(e) => setConfirma(e.target.checked)} />
            Confirmo que las recetas en papel de este lote fueron destruidas.
          </label>
        </div>
      </div>
      <SimpleForm action={registrarDestruccionAction} submitLabel="Registrar destrucción" pendingLabel="Registrando…" submitDisabled={!confirma}>
        <input type="hidden" name="id" value={loteId} />
        <div className="field">
          <label htmlFor="fechaDestruccion" className="field-label">
            Fecha de destrucción
          </label>
          <DateInput id="fechaDestruccion" name="fechaDestruccion" required />
        </div>
        <PasswordField />
      </SimpleForm>
    </PasoPanel>
  );
}
