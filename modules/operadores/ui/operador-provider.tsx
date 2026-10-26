"use client";

/**
 * Mounted once in the authenticated layout (`app/(app)/layout.tsx`) for a
 * cuenta de sector (openspec/specs/cuentas-de-sector/spec.md): provides
 * `shared/ui/operador.tsx`'s context to every form and renders THE prompt
 * that asks which empleado is acting and their PIN.
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
import { AUTH_POLICY } from "@/shared/auth/policy";
import { CAMPO_OPERADOR_ID, CAMPO_OPERADOR_METODO, CAMPO_OPERADOR_PIN } from "@/shared/auth/operador-campos";
import { OperadorContextProvider, type CamposDeOperador, type OperadorContextValue } from "@/shared/ui/operador";
import type { OperadorOpcion } from "../application/list-operadores";
import { listarOperadoresAction } from "./actions";

/** The last empleado who identified themselves on this terminal: preselected, so the usual case is "type your PIN". */
const ULTIMO_OPERADOR_KEY = "fsj.operador.ultimo";

interface Pedido {
  error?: string;
  resolver: (campos: CamposDeOperador | null) => void;
}

export interface OperadorProviderProps {
  /** The acciones the cuenta de sector holds AND the farmacia asks a PIN for (`session.sector.permisosConPin` ∩ `session.permisos`). */
  permisosConPin: readonly string[];
  children: ReactNode;
}

export function OperadorProvider({ permisosConPin, children }: OperadorProviderProps) {
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
      {pedido ? <OperadorPrompt error={pedido.error} onConfirm={responder} onCancel={() => responder(null)} /> : null}
    </OperadorContextProvider>
  );
}

interface OperadorPromptProps {
  error?: string;
  onConfirm: (campos: CamposDeOperador) => void;
  onCancel: () => void;
}

function OperadorPrompt({ error, onConfirm, onCancel }: OperadorPromptProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const tituloId = useId();
  const operadorId = useId();
  const pinId = useId();
  const [operadores, setOperadores] = useState<OperadorOpcion[] | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [elegido, setElegido] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    let vigente = true;
    listarOperadoresAction().then((resultado) => {
      if (!vigente) return;
      if (resultado.status === "error") {
        setErrorCarga(resultado.message);
        setOperadores([]);
        return;
      }
      const ultimo = window.localStorage.getItem(ULTIMO_OPERADOR_KEY);
      const preseleccion = resultado.operadores.length === 1 ? resultado.operadores[0]!.id : resultado.operadores.some((o) => o.id === ultimo) ? ultimo! : "";
      setOperadores(resultado.operadores);
      setElegido(preseleccion);
    });
    return () => {
      vigente = false;
    };
  }, []);

  // Once the list is in: straight to the PIN when the empleado is already chosen.
  useEffect(() => {
    if (operadores === null) return;
    if (elegido) pinRef.current?.focus();
    else selectRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operadores]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    event.stopPropagation();
    const pin = pinRef.current?.value ?? "";
    if (!elegido || pin.length === 0) return;
    window.localStorage.setItem(ULTIMO_OPERADOR_KEY, elegido);
    onConfirm({ [CAMPO_OPERADOR_ID]: elegido, [CAMPO_OPERADOR_METODO]: "PIN", [CAMPO_OPERADOR_PIN]: pin });
  }

  const sinOperadores = operadores !== null && operadores.length === 0 && !errorCarga;

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
            <p className="text-sm text-zinc-600">Elegite e ingresá tu PIN. La acción queda registrada a tu nombre.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor={operadorId} className="field-label">
            Empleado
          </label>
          <select ref={selectRef} id={operadorId} required value={elegido} onChange={(event) => setElegido(event.target.value)} disabled={operadores === null} className="input">
            <option value="">{operadores === null ? "Cargando…" : "Seleccioná tu nombre"}</option>
            {(operadores ?? []).map((operador) => (
              <option key={operador.id} value={operador.id}>
                {operador.apellido}, {operador.nombre}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor={pinId} className="field-label">
            PIN
          </label>
          <input
            ref={pinRef}
            id={pinId}
            type="password"
            inputMode="numeric"
            pattern={`\\d{${AUTH_POLICY.pinLength}}`}
            maxLength={AUTH_POLICY.pinLength}
            required
            autoComplete="off"
            className="input"
          />
        </div>

        {sinOperadores ? (
          <p role="note" className="text-sm text-zinc-600">
            Ningún empleado tiene un PIN configurado todavía. Cada uno lo configura desde «Mi cuenta», con su propio usuario.
          </p>
        ) : null}

        {error || errorCarga ? (
          <div role="alert" className="alert alert-danger">
            <CircleAlert aria-hidden />
            <p>{error ?? errorCarga}</p>
          </div>
        ) : null}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="btn btn-secondary">
            Cancelar
          </button>
          <button type="submit" disabled={!elegido} className="btn btn-primary">
            Confirmar
          </button>
        </div>
      </form>
    </dialog>
  );
}
