"use client";

/**
 * "Elaborar lote" in a dialog (openspec/changes/lotes-elaborados): opened from Partidas' "Elaborar lote", a partida's
 * "Diluir" and the pesaje's "Crear dilución" for a dose below the balance, so the user never leaves the screen they
 * work on. Same native `<dialog>` + `showModal()` approach as
 * modules/preparaciones/ui/continuar-preparacion-dialog.tsx; opened for a droga, it reads its lots first
 * (`datosParaElaborarAction`, fresh stock on every opening).
 *
 * Rendered in a portal: the pesaje's trigger sits inside another form, and a `<form>` can not nest. React still
 * bubbles events through the component tree, so the dialog stops the submit before it reaches that outer form.
 */
import { useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CircleAlert, X } from "lucide-react";
import { toast } from "@/shared/ui/toast";
import { ElaborarLoteForm, type ElaborarLoteFormProps } from "./elaborar-lote-form";
import { datosParaElaborarAction } from "./actions";

type Contenido = { status: "listo"; inicial: ElaborarLoteFormProps["inicial"] } | { status: "error"; message: string };

export interface ElaborarLoteDialogProps {
  /** The trigger button: its text, icon, classes and tooltip. */
  label: string;
  icon: ReactNode;
  className: string;
  title?: string;
  /** Opened for a droga to dilute (a partida's "Diluir", the pesaje): its lots are loaded on opening. */
  drogaId?: string;
  /** The lot whose quantity gets the focus (a partida's "Diluir"). */
  partidaId?: string;
  /** After the lot is elaborated (dialog closed, message toasted). By default, opens the new partida. */
  onElaborado?: (partidaId: string) => void;
}

export function ElaborarLoteDialog({ label, icon, className, title, drogaId, partidaId, onElaborado }: ElaborarLoteDialogProps) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  // Bumped on every opening and closing: a late answer from a previous opening is ignored.
  const aperturaRef = useRef(0);
  const tituloId = useId();
  const [abierto, setAbierto] = useState(false);
  /** `null` while the droga's lots load. */
  const [contenido, setContenido] = useState<Contenido | null>(null);

  async function abrir() {
    const apertura = ++aperturaRef.current;
    setContenido(drogaId ? null : { status: "listo", inicial: null });
    setAbierto(true);
    if (!drogaId) return;
    const respuesta = await datosParaElaborarAction(drogaId);
    if (aperturaRef.current !== apertura) return;
    setContenido(
      respuesta.status === "error" ? respuesta : { status: "listo", inicial: { datos: respuesta.datos, tipo: "DILUCION", partidaId: partidaId ?? null } },
    );
  }

  function cerrar() {
    dialogRef.current?.close();
  }

  const cancelar = (
    <button type="button" onClick={cerrar} className="btn btn-secondary">
      Cancelar
    </button>
  );

  return (
    <>
      <button type="button" onClick={abrir} aria-haspopup="dialog" title={title} className={className}>
        {icon}
        {label}
      </button>
      {abierto
        ? createPortal(
            <dialog
              ref={(el) => {
                dialogRef.current = el;
                if (el && !el.open) el.showModal();
              }}
              aria-labelledby={tituloId}
              // Escape or `close()`: the next opening starts over with fresh data.
              onClose={() => {
                aperturaRef.current++;
                setAbierto(false);
                setContenido(null);
              }}
              onSubmit={(event) => event.stopPropagation()}
              className="card m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-4xl p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div className="flex flex-col gap-4 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={tituloId} className="text-lg font-semibold">
                      Elaborar lote
                    </h2>
                    <p className="text-sm text-zinc-500">Descuenta los lotes que usa y entra al stock como una partida nueva.</p>
                  </div>
                  <button type="button" onClick={cerrar} aria-label="Cerrar" className="btn btn-ghost btn-sm">
                    <X className="size-4" aria-hidden />
                  </button>
                </div>

                {contenido === null ? (
                  <p role="status" className="text-sm text-zinc-500">
                    Cargando lotes…
                  </p>
                ) : contenido.status === "error" ? (
                  <>
                    <div role="alert" className="alert alert-danger">
                      <CircleAlert aria-hidden />
                      <p>{contenido.message}</p>
                    </div>
                    <div className="flex justify-end">{cancelar}</div>
                  </>
                ) : (
                  <ElaborarLoteForm
                    inicial={contenido.inicial}
                    extraActions={cancelar}
                    onElaborado={(nuevaPartidaId, message) => {
                      if (message) toast(message);
                      cerrar();
                      if (onElaborado) onElaborado(nuevaPartidaId);
                      else router.push(`/partidas/${nuevaPartidaId}`);
                    }}
                  />
                )}
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </>
  );
}
