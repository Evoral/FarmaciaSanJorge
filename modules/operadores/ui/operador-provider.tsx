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

interface Pedido {
  error?: string;
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

  const responder = useCallback((campos: CamposDeOperador | null) => {
    pedidoRef.current?.resolver(campos);
    pedidoRef.current = null;
    setPedido(null);
  }, []);

  const value = useMemo<OperadorContextValue>(() => {
    const conPin = new Set(permisosConPin);
    return {
      requierePin: (accion) => conPin.has(accion),
      pedir: (error) =>
        new Promise((resolver) => {
          // One prompt at a time: a newer request supersedes a pending one.
          pedidoRef.current?.resolver(null);
          const nuevo: Pedido = { error, resolver };
          pedidoRef.current = nuevo;
          setPedido(nuevo);
        }),
    };
  }, [permisosConPin]);

  return (
    <OperadorContextProvider value={value}>
      {children}
      {pedido ? <OperadorPrompt error={pedido.error} metodos={metodos} onConfirm={responder} onCancel={() => responder(null)} /> : null}
    </OperadorContextProvider>
  );
}

interface OperadorPromptProps {
  error?: string;
  metodos: readonly MetodoVerificacion[];
  onConfirm: (campos: CamposDeOperador) => void;
  onCancel: () => void;
}

/** The enabled methods, the one with the highest priority first. */
function ordenarPorPrioridad(metodos: readonly MetodoVerificacion[]): MetodoVerificacion[] {
  const conocidos = METODOS_VERIFICACION.filter((metodo) => metodos.includes(metodo));
  return (conocidos.length > 0 ? conocidos : [METODO_POR_DEFECTO]).sort((a, b) => METODOS_EN_DIALOGO[b].prioridad - METODOS_EN_DIALOGO[a].prioridad);
}

function OperadorPrompt({ error, metodos, onConfirm, onCancel }: OperadorPromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);
  const tituloId = useId();
  const campoId = useId();
  const ofrecidos = ordenarPorPrioridad(metodos);
  // The empleado's pick, kept only while it is still offered: if `metodos` changes with the dialog open, the selection
  // falls back to the first offered method instead of pointing at one that is gone.
  const [elegido, setElegido] = useState<MetodoVerificacion | null>(null);
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
    if (!completo) return;
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
              <button key={opcion} type="button" aria-pressed={opcion === metodo} onClick={() => setElegido(opcion)} className="btn btn-secondary">
                {METODOS[opcion].etiqueta}
              </button>
            ))}
          </div>
        ) : null}

        <Campo
          id={campoId}
          ref={campoRef}
          valores={valores}
          onChange={(clave, valor) => setValores((actuales) => ({ ...actuales, [clave]: valor }))}
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
