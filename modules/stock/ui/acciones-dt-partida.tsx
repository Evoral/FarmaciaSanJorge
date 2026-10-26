"use client";

/**
 * The Director Técnico's own actions on a DROGA partida (openspec/specs/reanalisis-partida/spec.md), on `/partidas/[id]`
 * and inline on each row of "Gestión DT › Vencimientos" (`/cierres/vencimientos`, `compacto` buttons).
 * The page renders them only for a DT vigente (titular or suplente); the commands re-check it, and so does the DB.
 * Each one asks for the DT's OWN password in the same form (no co-firma picker: the DT is the session's usuario).
 *   - `ReanalisisDialog`: "Registrar reanálisis" -- the new date (strictly after today), motivo and respaldo
 *     (optional). The original vencimiento is never overwritten; the reanálisis is added to the history.
 *   - `MarcarVencidaDialog`: "Marcar como vencida" -- a warning first: the WHOLE saldo is discounted (AJUSTE
 *     VENCIMIENTO) and the partida admits no more reanálisis.
 * Native `<dialog>` like modules/preparaciones/ui/reserva-acciones.tsx (no backdrop close: it would lose what was
 * entered); `SimpleForm` keeps every field on error and resets only on success.
 */
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CalendarClock, CircleAlert, PackageX, X } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { DateInput } from "@/shared/ui/date-input";
import { toast } from "@/shared/ui/toast";
import { marcarPartidaVencidaAction, registrarReanalisisAction } from "./actions";

const DIALOG_CLASS =
  "card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900";

interface MarcoDialogoProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  titulo: string;
  subtitulo: string;
  onCerrar: () => void;
  /** The `<dialog>`'s close event (any way it closes). */
  onClose: () => void;
  children: ReactNode;
}

function MarcoDialogo({ dialogRef, titulo, subtitulo, onCerrar, onClose, children }: MarcoDialogoProps) {
  const tituloId = useId();
  return (
    <dialog ref={dialogRef} aria-labelledby={tituloId} onClose={onClose} className={DIALOG_CLASS}>
      <div className="flex flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={tituloId} className="text-lg font-semibold">
              {titulo}
            </h2>
            <p className="truncate text-sm text-zinc-500">{subtitulo}</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

function PasswordDt({ id }: { id: string }) {
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        Tu contraseña (Director Técnico)
      </label>
      <input id={id} name="password" type="password" autoComplete="current-password" required className="input" />
    </div>
  );
}

/** One day after `iso` (YYYY-MM-DD), for the date field's `min`. */
function diaSiguiente(iso: string): string {
  const fecha = new Date(`${iso}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + 1);
  return fecha.toISOString().slice(0, 10);
}

export interface ReanalisisDialogProps {
  partidaId: string;
  /** "Droga · lote X", under the title. */
  partidaNombre: string;
  /** The tenant's jornada (YYYY-MM-DD): the new date must be after it. */
  jornadaActual: string;
  /** Emphasized button (the partida is vencida or por vencer). */
  destacado: boolean;
  /** Small button, for a table row: icon-only below md (the label stays as its accessible name and tooltip). */
  compacto?: boolean;
}

/** The trigger's label: always visible on a full button; on a compact one only from md up. */
function EtiquetaBoton({ texto, compacto }: { texto: string; compacto: boolean }) {
  return compacto ? <span className="hidden md:inline">{texto}</span> : <>{texto}</>;
}

export function ReanalisisDialog({ partidaId, partidaNombre, jornadaActual, destacado, compacto = false }: ReanalisisDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const campoId = useId();
  // Bumped on every closing: the next opening starts with an empty form.
  const [apertura, setApertura] = useState(0);

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-haspopup="dialog"
        aria-label={compacto ? `Registrar reanálisis de ${partidaNombre}` : undefined}
        title={compacto ? "Registrar reanálisis" : undefined}
        className={`btn ${destacado ? "btn-primary" : "btn-secondary"}${compacto ? " btn-sm" : ""}`}
      >
        <CalendarClock className="size-4" aria-hidden />
        <EtiquetaBoton texto="Registrar reanálisis" compacto={compacto} />
      </button>
      <MarcoDialogo dialogRef={dialogRef} titulo="Registrar reanálisis" subtitulo={partidaNombre} onCerrar={cerrar} onClose={() => setApertura((n) => n + 1)}>
        <p className="text-sm text-zinc-600">
          La fecha de reanálisis pasa a ser el vencimiento vigente de la partida. El vencimiento original se conserva y el reanálisis queda en el historial.
        </p>
        <SimpleForm
          key={apertura}
          action={registrarReanalisisAction}
          submitLabel="Registrar reanálisis"
          pendingLabel="Registrando…"
          className="flex flex-col gap-4"
          extraActions={
            <button type="button" onClick={cerrar} className="btn btn-secondary">
              Cancelar
            </button>
          }
          onSuccess={(state) => {
            if (state.message) toast(state.message);
            cerrar();
          }}
        >
          <input type="hidden" name="partidaId" value={partidaId} />
          <div className="field">
            <label htmlFor={`${campoId}-fecha`} className="field-label">
              Fecha de reanálisis
            </label>
            <DateInput id={`${campoId}-fecha`} name="fechaReanalisis" required min={diaSiguiente(jornadaActual)} />
            <p className="field-help">Nuevo vencimiento vigente; posterior a hoy.</p>
          </div>
          <div className="field">
            <label htmlFor={`${campoId}-respaldo`} className="field-label">
              Respaldo (opcional)
            </label>
            <input id={`${campoId}-respaldo`} name="respaldo" type="text" maxLength={200} className="input" />
            <p className="field-help">Certificado de análisis o número de protocolo.</p>
          </div>
          <div className="field">
            <label htmlFor={`${campoId}-motivo`} className="field-label">
              Motivo (opcional)
            </label>
            <textarea id={`${campoId}-motivo`} name="motivo" rows={2} maxLength={500} className="input" />
          </div>
          <PasswordDt id={`${campoId}-password`} />
        </SimpleForm>
      </MarcoDialogo>
    </>
  );
}

export interface MarcarVencidaDialogProps {
  partidaId: string;
  partidaNombre: string;
  /** The saldo that will be discounted, already formatted with its unit. */
  saldoTexto: string;
  /** Small button, for a table row: icon-only below md (the label stays as its accessible name and tooltip). */
  compacto?: boolean;
}

export function MarcarVencidaDialog({ partidaId, partidaNombre, saldoTexto, compacto = false }: MarcarVencidaDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const campoId = useId();
  const [apertura, setApertura] = useState(0);

  function cerrar() {
    dialogRef.current?.close();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        aria-haspopup="dialog"
        aria-label={compacto ? `Marcar como vencida ${partidaNombre}` : undefined}
        title={compacto ? "Marcar como vencida" : undefined}
        className={`btn btn-secondary${compacto ? " btn-sm" : ""}`}
      >
        <PackageX className="size-4" aria-hidden />
        <EtiquetaBoton texto="Marcar como vencida" compacto={compacto} />
      </button>
      <MarcoDialogo dialogRef={dialogRef} titulo="Marcar como vencida" subtitulo={partidaNombre} onCerrar={cerrar} onClose={() => setApertura((n) => n + 1)}>
        <div role="alert" className="alert alert-danger">
          <CircleAlert aria-hidden />
          <p>
            Se va a descontar a cero el saldo de esta partida (<strong className="font-mono">{saldoTexto}</strong>) con un ajuste por vencimiento. La partida queda
            cerrada: no admite más reanálisis y no se puede deshacer.
          </p>
        </div>
        <SimpleForm
          key={apertura}
          action={marcarPartidaVencidaAction}
          submitLabel="Descontar saldo y marcar vencida"
          pendingLabel="Registrando…"
          submitVariant="danger-solid"
          className="flex flex-col gap-4"
          extraActions={
            <button type="button" onClick={cerrar} className="btn btn-secondary">
              Cancelar
            </button>
          }
          onSuccess={(state) => {
            if (state.message) toast(state.message);
            cerrar();
          }}
        >
          <input type="hidden" name="partidaId" value={partidaId} />
          <div className="field">
            <label htmlFor={`${campoId}-observacion`} className="field-label">
              Observación (opcional)
            </label>
            <input id={`${campoId}-observacion`} name="observacion" type="text" maxLength={500} className="input" />
          </div>
          <PasswordDt id={`${campoId}-password`} />
        </SimpleForm>
      </MarcoDialogo>
    </>
  );
}
