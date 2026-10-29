"use client";

/**
 * Container component for chat-ayuda (CA1, CA4b, CA6, CA7, CA9, CA11, CA14).
 *
 * Owns client state:
 * - `conversacionId` (UUID generated once per panel session)
 * - `mensajes` list
 * - `foco` (entrada.id of the last respondida answer, CA7)
 * - form input, pending state, and field error marking (CA9, CA11)
 * - "¿Te sirvió?" rating feedback state with toast on failure (CA14)
 * - open/close, focus management, and Escape key listener
 */
import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { useFieldErrors } from "@/shared/ui/field-errors";
import { toast } from "@/shared/ui/toast";
import type { ActionErrorState } from "@/shared/ui/action-error";
import { LIMITES_AYUDA } from "../domain/armar-contexto";
import { MENSAJE_AYUDA_NO_DISPONIBLE } from "../domain/resolver-respuesta";
import {
  consultarAyudaAction,
  calificarRespuestaAyudaAction,
  type ConsultarAyudaActionState,
} from "./actions";
import { ChatAyuda, type MensajeChat } from "./chat-ayuda";

type FormState =
  | { status: "idle" }
  | { status: "success" }
  | ActionErrorState;

export function ChatAyudaContainer() {
  const [open, setOpen] = useState(false);
  const [conversacionId] = useState<string>(() => crypto.randomUUID());
  const [mensajes, setMensajes] = useState<MensajeChat[]>([]);
  const [foco, setFoco] = useState<string | null>(null);
  const [textoPregunta, setTextoPregunta] = useState("");
  const [calificaciones, setCalificaciones] = useState<
    Record<string, "enviando" | "calificado">
  >({});

  const formRef = useRef<HTMLFormElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Focus question input on open; close on Escape
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape" && !event.defaultPrevented) {
        const target = event.target as Node | null;
        if (target && panelRef.current?.contains(target)) {
          event.preventDefault();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Scroll to bottom on new messages or when opened
  useEffect(() => {
    if (open) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [mensajes, open]);

  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    async (_prevState, formData) => {
      const rawPregunta = formData.get("pregunta");
      const pregunta =
        typeof rawPregunta === "string" ? rawPregunta.trim() : "";
      if (!pregunta) {
        return { status: "idle" };
      }

      // Build historial from previous non-error turns
      const historial = mensajes
        .filter(
          (m) =>
            m.rol === "usuario" ||
            (m.rol === "asistente" && m.tipo !== "error")
        )
        .slice(-LIMITES_AYUDA.mensajesHistorial)
        .map((m) => ({
          rol: m.rol,
          contenido: m.texto.slice(0, LIMITES_AYUDA.caracteresMensaje),
        }));

      const userMsgId = crypto.randomUUID();

      // Append user message immediately
      setMensajes((prev) => [
        ...prev,
        { id: userMsgId, rol: "usuario", texto: pregunta },
      ]);

      let res: ConsultarAyudaActionState;
      try {
        res = await consultarAyudaAction({
          conversacionId,
          pregunta,
          historial,
          foco: foco ?? undefined,
        });
      } catch {
        setMensajes((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: crypto.randomUUID(),
            rol: "asistente",
            tipo: "error",
            texto: MENSAJE_AYUDA_NO_DISPONIBLE,
          },
        ]);
        return { status: "error", message: MENSAJE_AYUDA_NO_DISPONIBLE };
      }

      // Action validation or authorization error
      if ("status" in res) {
        setMensajes((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: crypto.randomUUID(),
            rol: "asistente",
            tipo: "error",
            texto: res.message,
          },
        ]);
        // Keep typed question in field on error (CA9, CA11)
        return res;
      }

      // Provider failure (returned as resultado ConsultaAyuda with tipo "error")
      if (res.tipo === "error") {
        setMensajes((prev) => [
          ...prev.filter((m) => m.id !== userMsgId),
          {
            id: crypto.randomUUID(),
            rol: "asistente",
            tipo: "error",
            texto: res.respuesta,
          },
        ]);
        // Keep typed question in field on error (CA11)
        return { status: "error", message: res.respuesta };
      }

      // Answered response: updates focus entry (CA7)
      if (res.tipo === "respondida" && res.entrada) {
        setFoco(res.entrada.id);
        setMensajes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            rol: "asistente",
            tipo: "respondida",
            texto: res.respuesta,
            entrada: res.entrada!,
            consultaId: res.consultaId,
          },
        ]);
      } else {
        // fuera_de_opciones: focus unchanged (CA4b, CA7)
        setMensajes((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            rol: "asistente",
            tipo: "fuera_de_opciones",
            texto: res.respuesta,
            consultaId: res.consultaId,
          },
        ]);
      }

      // Clear field only on success
      setTextoPregunta("");
      return { status: "success" };
    },
    { status: "idle" }
  );

  // Automatically mark invalid fields on form error (e.g. pregunta too long, CA9)
  useFieldErrors(
    formRef,
    state.status === "error" && state.fields ? state.fields : undefined
  );

  const { onSubmit } = useFormSubmit(formAction, {
    estado: state.status === "error" ? state : undefined,
  });

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (!isPending && textoPregunta.trim().length > 0) {
          formRef.current?.requestSubmit();
        }
      }
    },
    [isPending, textoPregunta]
  );

  const handleCalificar = useCallback(
    async (consultaId: string, util: boolean) => {
      // Mark as sending/rated immediately
      setCalificaciones((prev) => ({ ...prev, [consultaId]: "enviando" }));

      try {
        const res = await calificarRespuestaAyudaAction({
          consultaId,
          util,
        });

        if (res.status === "error") {
          // Re-enable buttons on failure
          setCalificaciones((prev) => {
            const next = { ...prev };
            delete next[consultaId];
            return next;
          });
          toast(res.message, "error");
        } else {
          setCalificaciones((prev) => ({
            ...prev,
            [consultaId]: "calificado",
          }));
        }
      } catch {
        // Re-enable buttons on failure
        setCalificaciones((prev) => {
          const next = { ...prev };
          delete next[consultaId];
          return next;
        });
        toast("No se pudo registrar la calificación.", "error");
      }
    },
    []
  );

  const handleClose = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const handleToggle = useCallback(() => {
    setOpen((prev) => !prev);
  }, []);

  return (
    <ChatAyuda
      open={open}
      onToggle={handleToggle}
      onClose={handleClose}
      mensajes={mensajes}
      textoPregunta={textoPregunta}
      onTextoPreguntaChange={setTextoPregunta}
      isPending={isPending}
      onSubmit={onSubmit}
      onKeyDown={handleKeyDown}
      formRef={formRef}
      panelRef={panelRef}
      inputRef={inputRef}
      triggerRef={triggerRef}
      messagesEndRef={messagesEndRef}
      calificaciones={calificaciones}
      onCalificar={handleCalificar}
    />
  );
}
