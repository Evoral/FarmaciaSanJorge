"use client";

/**
 * Mounted once in the authenticated layout (`app/(app)/layout.tsx`) for a
 * cuenta de sector (openspec/specs/cuentas-de-sector/spec.md): provides
 * `shared/ui/operador.tsx`'s context to every form and renders THE prompt
 * that asks the acting empleado's PIN. The PIN alone identifies them (no two
 * usuarios of a farmacia share one): there is no "¿quién sos?" selector
 * (user decision 2026-10-28).
 *
 * The form plumbing (`shared/ui/use-form-submit.ts`) calls `pedir()`; the
 * promise resolves with the credential fields it adds to the submit, or
 * `null` when the empleado cancels. Nothing is verified here: the server
 * checks the PIN in the same request as the act (shared/usecase.ts).
 *
 * Native `<dialog>` + `showModal()`, like shared/ui/route-dialog.tsx: it
 * must open ABOVE the dialogs many of these forms live in, and only another
 * top-layer element can.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CircleAlert, UserRoundCheck } from "lucide-react";
import { CAMPO_OPERADOR_METODO, campoDeOperador } from "@/shared/auth/operador-campos";
import { METODOS, METODOS_VERIFICACION, METODO_POR_DEFECTO, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";
import { OperadorContextProvider, type CamposDeOperador, type OperadorContextValue } from "@/shared/ui/operador";
import { METODOS_EN_DIALOGO } from "./metodos-en-dialogo";

/**
 * How long the answered prompt of a reader method (`lector` in the registry) stays mounted, so a reader's second Enter
 * lands on it (and is swallowed) and not on the page behind it. The PIN dialog closes immediately, as it always did.
 */
const MS_HASTA_CERRAR = 300;

interface Pedido {
  /** One per request: the prompt of a retry after a rejection is a new one (a lingering answered prompt keeps its id, so answering does not remount it). */
  id: number;
  error?: string;
  /** Set when the request is a retry after a rejection: the dialog reopens on the method that was just rejected. */
  metodoInicial?: MetodoVerificacion;
  resolver: (campos: CamposDeOperador | null) => void;
}

export interface OperadorProviderProps {
  /** The acciones the cuenta de sector holds AND the farmacia asks a PIN for (`session.sector.permisosConPin` ∩ `session.permisos`). */
  permisosConPin: readonly string[];
  /** The methods the dialog offers. Defaults to the PIN, which every farmacia has. */
  metodos?: readonly MetodoVerificacion[];
  children: ReactNode;
}

const METODOS_POR_DEFECTO: readonly MetodoVerificacion[] = [METODO_POR_DEFECTO];

export function OperadorProvider({ permisosConPin, metodos = METODOS_POR_DEFECTO, children }: OperadorProviderProps) {
  const [pedido, setPedido] = useState<Pedido | null>(null);
  const pedidoRef = useRef<Pedido | null>(null);
  // The method of the last proof sent, so a rejection reopens the dialog on it instead of on the default method.
  const ultimoMetodoRef = useRef<MetodoVerificacion | undefined>(undefined);
  const siguienteIdRef = useRef(0);

  const responder = useCallback((campos: CamposDeOperador | null) => {
    const actual = pedidoRef.current;
    if (!actual) return; // already answered: a second Enter from the reader is a no-op
    pedidoRef.current = null;
    if (!campos) {
      actual.resolver(null);
      setPedido(null);
      return;
    }
    const metodo = METODOS_VERIFICACION.find((candidato) => candidato === campos[CAMPO_OPERADOR_METODO]);
    if (metodo) ultimoMetodoRef.current = metodo;
    actual.resolver(campos);
    if (!metodo || METODOS_EN_DIALOGO[metodo].lector !== true) {
      setPedido(null);
      return;
    }
    // A reader method: keep the answered prompt mounted for a moment (see MS_HASTA_CERRAR); its form swallows the
    // reader's second Enter. A newer request replaces it before then.
    window.setTimeout(() => setPedido((visible) => (visible === actual ? null : visible)), MS_HASTA_CERRAR);
  }, []);

  const value = useMemo<OperadorContextValue>(() => {
    const conPin = new Set(permisosConPin);
    return {
      requierePin: (accion) => conPin.has(accion),
      pedir: (error) =>
        new Promise((resolver) => {
          // One prompt at a time: a newer request supersedes a pending one.
          pedidoRef.current?.resolver(null);
          const nuevo: Pedido = { id: siguienteIdRef.current++, error, resolver, metodoInicial: error ? ultimoMetodoRef.current : undefined };
          pedidoRef.current = nuevo;
          setPedido(nuevo);
        }),
    };
  }, [permisosConPin]);

  return (
    <OperadorContextProvider value={value}>
      {children}
      {pedido ? (
        // A new request (a retry after a rejection) is a new prompt: its state (typed code, selected method) starts clean.
        <OperadorPrompt
          key={pedido.id}
          error={pedido.error}
          metodoInicial={pedido.metodoInicial}
          metodos={metodos}
          onConfirm={responder}
          onCancel={() => responder(null)}
        />
      ) : null}
    </OperadorContextProvider>
  );
}

interface OperadorPromptProps {
  error?: string;
  metodoInicial?: MetodoVerificacion;
  metodos: readonly MetodoVerificacion[];
  onConfirm: (campos: CamposDeOperador) => void;
  onCancel: () => void;
}

/** The enabled methods, the one with the highest priority first. */
function ordenarPorPrioridad(metodos: readonly MetodoVerificacion[]): MetodoVerificacion[] {
  const conocidos = METODOS_VERIFICACION.filter((metodo) => metodos.includes(metodo));
  return (conocidos.length > 0 ? conocidos : [METODO_POR_DEFECTO]).sort((a, b) => METODOS_EN_DIALOGO[b].prioridad - METODOS_EN_DIALOGO[a].prioridad);
}

function OperadorPrompt({ error, metodoInicial, metodos, onConfirm, onCancel }: OperadorPromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  // Set synchronously by the first accepted submit: a second one (a reader's repeated Enter) never reaches `onConfirm`.
  const respondido = useRef(false);
  const tituloId = useId();
  const campoId = useId();
  const ofrecidos = ordenarPorPrioridad(metodos);
  // The empleado's pick, kept only while it is still offered: if `metodos` changes with the dialog open, the selection
  // falls back to the first offered method instead of pointing at one that is gone.
  const [elegido, setElegido] = useState<MetodoVerificacion | null>(metodoInicial ?? null);
  // The rejection mark stays until the empleado edits the field or switches method.
  const [editado, setEditado] = useState(false);
  const metodo = elegido && ofrecidos.includes(elegido) ? elegido : ofrecidos[0]!;
  const [valores, setValores] = useState<Record<string, string>>({});
  const { Campo } = METODOS_EN_DIALOGO[metodo];
  const claves = METODOS[metodo].claves as readonly string[];
  const completo = claves.every((clave) => (valores[clave] ?? "").length > 0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  // The selected method's input is focused on open and on every switch.
  useEffect(() => {
    campoRef.current?.focus();
  }, [metodo]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!completo || respondido.current) return;
    respondido.current = true;
    const campos: CamposDeOperador = { [CAMPO_OPERADOR_METODO]: metodo };
    for (const clave of claves) campos[campoDeOperador(clave)] = valores[clave]!;
    onConfirm(campos);
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={tituloId}
      // Escape closes the native dialog: that is a cancel.
      onClose={onCancel}
      className="card m-auto w-[calc(100%-2rem)] max-w-sm p-0 text-left text-foreground shadow-lg backdrop:bg-black/40 dark:border-zinc-800 dark:bg-zinc-900"
    >
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 p-5">
        <div className="flex items-start gap-3">
          <span className="tone-tile" data-tone="success" aria-hidden>
            <UserRoundCheck />
          </span>
          <div>
            <h2 id={tituloId} className="text-lg font-semibold">
              ¿Quién realiza esta acción?
            </h2>
            <p className="text-sm text-zinc-600">{METODOS_EN_DIALOGO[metodo].ayuda}</p>
          </div>
        </div>

        {/* A single method shows no switch: a PIN-only farmacia sees the dialog as it always was. */}
        {ofrecidos.length > 1 ? (
          <div className="flex gap-2">
            {ofrecidos.map((opcion) => (
              <button
                key={opcion}
                type="button"
                aria-pressed={opcion === metodo}
                onClick={() => {
                  if (opcion === metodo) return;
                  setElegido(opcion);
                  // The secret typed for the method being left must not linger, hidden, in this state.
                  setValores({});
                  setEditado(true);
                }}
                className="btn btn-secondary"
              >
                {METODOS[opcion].etiqueta}
              </button>
            ))}
          </div>
        ) : null}

        <Campo
          id={campoId}
          ref={campoRef}
          valores={valores}
          onChange={(clave, valor) => {
            setValores((actuales) => ({ ...actuales, [clave]: valor }));
            setEditado(true);
          }}
          invalido={Boolean(error) && !editado}
        />

        {error ? (
          <div role="alert" className="alert alert-danger">
            <CircleAlert aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={!completo} className="btn btn-primary">
            Confirmar
          </button>
        </div>
      </form>
    </dialog>
  );
}
