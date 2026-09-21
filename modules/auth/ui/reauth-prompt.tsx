"use client";

/**
 * Reusable step-up (re-authentication) prompt (M02, FASE 2 point 2.5,
 * INV-X02). Deliberately generic: it asks for the password, calls
 * `reautenticar`, and on success tells the caller "you're re-authenticated
 * now, go ahead and retry" -- it does not know or execute the original
 * action itself. A future caller (confirmar preparación, firmar cierre --
 * FASE 8/10) catches its own `StepUpRequiredError` (shared/errors), shows
 * this component, and on `onReauthenticated` re-invokes whatever it was
 * trying to do. Kept intentionally unstyled beyond the existing Tailwind
 * setup (plan §16: "this is not the design phase").
 */
import { useRef, useState, useTransition } from "react";
import { reautenticarAction } from "./actions";

export interface ReauthPromptProps {
  /** Called once re-authentication succeeds -- the caller retries its original action from here. */
  onReauthenticated: () => void;
  /** Called when the user dismisses the prompt without re-authenticating. */
  onCancel: () => void;
}

export function ReauthPrompt({ onReauthenticated, onCancel }: ReauthPromptProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const password = String(formData.get("password") ?? "");
    startTransition(async () => {
      const result = await reautenticarAction(password);
      if (result.ok) {
        formRef.current?.reset();
        onReauthenticated();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="reauth-prompt-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        ref={formRef}
        action={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 id="reauth-prompt-title" className="mb-2 text-lg font-semibold">
          Confirmá tu contraseña
        </h2>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">Esta acción requiere que vuelvas a ingresar tu contraseña.</p>

        <label htmlFor="reauth-password" className="mb-1 block text-sm font-medium">
          Contraseña
        </label>
        <input
          id="reauth-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          autoFocus
          className="mb-2 w-full rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-800"
        />

        {error ? (
          <p role="alert" className="mb-2 text-sm text-red-600">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded px-3 py-2 text-sm">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={pending}
            className="rounded bg-zinc-900 px-3 py-2 text-sm text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "Verificando…" : "Confirmar"}
          </button>
        </div>
      </form>
    </div>
  );
}
