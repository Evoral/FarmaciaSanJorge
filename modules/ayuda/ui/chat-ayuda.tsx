"use client";

/**
 * Presentational component for chat-ayuda (CA1, CA4b, CA6, CA9, CA11, CA14).
 *
 * Pure rendering: receives state and callbacks from `ChatAyudaContainer`.
 * Uses app skin classes only:
 * - `panel`, `panel-header`, `panel-body`
 * - `btn`, `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-sm`, `btn-icon`
 * - `input`, `field`, `field-label`, `field-help`
 * - `alert`, `alert-info`, `alert-danger`
 * - `spinner`
 *
 * Renders plain text only for model responses (`whitespace-pre-line`),
 * never markdown, never `dangerouslySetInnerHTML`.
 */
import type { FormEvent, RefObject } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleAlert,
  CircleHelp,
  Info,
  Send,
  X,
} from "lucide-react";
import { LIMITES_AYUDA } from "../domain/armar-contexto";
import type { EntradaRespondida } from "../domain/resolver-respuesta";

export type MensajeChat =
  | {
      id: string;
      rol: "usuario";
      texto: string;
    }
  | {
      id: string;
      rol: "asistente";
      tipo: "respondida";
      texto: string;
      entrada: EntradaRespondida;
      consultaId?: string;
    }
  | {
      id: string;
      rol: "asistente";
      tipo: "fuera_de_opciones";
      texto: string;
      consultaId?: string;
    }
  | {
      id: string;
      rol: "asistente";
      tipo: "error";
      texto: string;
    };

export interface ChatAyudaProps {
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  mensajes: readonly MensajeChat[];
  textoPregunta: string;
  onTextoPreguntaChange: (texto: string) => void;
  isPending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  formRef: RefObject<HTMLFormElement | null>;
  panelRef: RefObject<HTMLElement | null>;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  triggerRef: RefObject<HTMLButtonElement | null>;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  calificaciones: Record<string, "enviando" | "calificado">;
  onCalificar: (consultaId: string, util: boolean) => void;
}

export function ChatAyuda({
  open,
  onToggle,
  onClose,
  mensajes,
  textoPregunta,
  onTextoPreguntaChange,
  isPending,
  onSubmit,
  onKeyDown,
  formRef,
  panelRef,
  inputRef,
  triggerRef,
  messagesEndRef,
  calificaciones,
  onCalificar,
}: ChatAyudaProps) {
  return (
    <>
      {/* Floating button (visible when closed) */}
      {!open ? (
        <button
          ref={triggerRef}
          type="button"
          onClick={onToggle}
          className="btn btn-primary fixed bottom-4 right-4 z-40 gap-2 rounded-full px-4 py-2.5 shadow-lg md:bottom-6 md:right-6"
          aria-label="Ayuda"
          aria-expanded={false}
          aria-controls="chat-ayuda-panel"
        >
          <CircleHelp className="size-5" aria-hidden />
          <span className="font-medium">Ayuda</span>
        </button>
      ) : null}

      {/* Phone bottom sheet backdrop (hidden on md+) */}
      {open ? (
        <div
          className="filter-drawer-backdrop md:hidden"
          aria-hidden
          onClick={onClose}
        />
      ) : null}

      {/* Help panel: bottom sheet on phones, non-modal side panel on md+ */}
      {open ? (
        <section
          ref={panelRef}
          id="chat-ayuda-panel"
          role="region"
          aria-label="Chat de ayuda"
          className="panel fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-xl rounded-b-none border-b-0 shadow-2xl md:inset-auto md:bottom-6 md:right-6 md:h-[34rem] md:max-h-[85vh] md:w-96 md:rounded-lg md:border-b md:shadow-xl"
        >
          {/* Header */}
          <div className="panel-header flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <CircleHelp className="size-4 text-primary" aria-hidden />
              <h2 className="text-sm font-semibold text-zinc-900">Ayuda</h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-icon"
              onClick={onClose}
              aria-label="Cerrar ayuda"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>

          {/* Messages list */}
          <div
            className="flex-1 space-y-3 overflow-y-auto p-4"
            role="log"
            aria-live="polite"
          >
            {mensajes.length === 0 ? (
              <div className="py-8 text-center text-sm text-zinc-500">
                <p className="font-medium text-zinc-700">
                  ¿En qué te puedo ayudar?
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  Preguntá cómo hacer una tarea o dónde encontrar una pantalla.
                </p>
              </div>
            ) : null}

            {mensajes.map((m) => {
              if (m.rol === "usuario") {
                return (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-white shadow-xs whitespace-pre-line">
                      {m.texto}
                    </div>
                  </div>
                );
              }

              return (
                <div key={m.id} className="flex max-w-[85%] flex-col items-start gap-1">
                  {m.tipo === "respondida" ? (
                    <div className="rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-900">
                      <p className="whitespace-pre-line">{m.texto}</p>
                      {m.entrada ? (
                        <div className="mt-2.5">
                          <Link
                            href={m.entrada.ruta}
                            className="btn btn-secondary btn-sm inline-flex items-center gap-1.5"
                          >
                            <ArrowUpRight className="size-3.5" aria-hidden />
                            <span>Ir a {m.entrada.titulo}</span>
                          </Link>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {m.tipo === "fuera_de_opciones" ? (
                    <div className="alert alert-info w-full text-sm">
                      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                      <div className="min-w-0 whitespace-pre-line">{m.texto}</div>
                    </div>
                  ) : null}

                  {m.tipo === "error" ? (
                    <div className="alert alert-danger w-full text-sm">
                      <CircleAlert
                        className="mt-0.5 size-4 shrink-0"
                        aria-hidden
                      />
                      <div className="min-w-0 whitespace-pre-line">{m.texto}</div>
                    </div>
                  ) : null}

                  {/* Rating control for respondida and fuera_de_opciones with consultaId */}
                  {(m.tipo === "respondida" || m.tipo === "fuera_de_opciones") &&
                  m.consultaId ? (
                    <CalificacionItem
                      consultaId={m.consultaId}
                      estado={calificaciones[m.consultaId]}
                      onCalificar={onCalificar}
                    />
                  ) : null}
                </div>
              );
            })}

            {isPending ? (
              <div className="flex max-w-[85%] items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-xs text-zinc-600">
                <span className="spinner" aria-hidden />
                <span>Buscando en la guía…</span>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>

          {/* Form */}
          <form
            ref={formRef}
            onSubmit={onSubmit}
            className="border-t border-zinc-200 bg-surface p-3"
          >
            <div className="field">
              <label htmlFor="ayuda-pregunta" className="sr-only">
                Pregunta de ayuda
              </label>
              <div className="relative">
                <textarea
                  ref={inputRef}
                  id="ayuda-pregunta"
                  name="pregunta"
                  rows={2}
                  maxLength={LIMITES_AYUDA.pregunta}
                  value={textoPregunta}
                  onChange={(e) => onTextoPreguntaChange(e.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Escribí tu consulta…"
                  disabled={isPending}
                  className="input w-full resize-none text-sm"
                />
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="tabular-nums">
                  {textoPregunta.length}/{LIMITES_AYUDA.pregunta}
                </span>

                <button
                  type="submit"
                  disabled={isPending || textoPregunta.trim().length === 0}
                  className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
                >
                  {isPending ? (
                    <>
                      <span className="spinner" aria-hidden />
                      <span>Consultando…</span>
                    </>
                  ) : (
                    <>
                      <Send className="size-3.5" aria-hidden />
                      <span>Enviar</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        </section>
      ) : null}
    </>
  );
}

function CalificacionItem({
  consultaId,
  estado,
  onCalificar,
}: {
  consultaId: string;
  estado?: "enviando" | "calificado";
  onCalificar: (consultaId: string, util: boolean) => void;
}) {
  const yaCalificado = estado === "enviando" || estado === "calificado";

  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
      <span>¿Te sirvió?</span>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={yaCalificado}
        onClick={() => onCalificar(consultaId, true)}
        aria-label="Sí, me sirvió"
      >
        Sí
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        disabled={yaCalificado}
        onClick={() => onCalificar(consultaId, false)}
        aria-label="No me sirvió"
      >
        No
      </button>
      {yaCalificado ? (
        <span className="font-medium text-zinc-600">Gracias</span>
      ) : null}
    </div>
  );
}
