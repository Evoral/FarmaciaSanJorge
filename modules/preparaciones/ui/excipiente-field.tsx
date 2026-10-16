"use client";

/**
 * "Excipiente utilizado" of a reserved ítem in the toma workspace (migration 0083, docs/specs/libro-recetario-y-contralor.md
 * "Excipiente utilizado"): optional, saved when the field is left (or on Enter) -- no button, it does not change the
 * flow. At "Imprimir etiquetas" it goes into the ítem's fórmula in the libro recetario and stays fixed. A failed save
 * keeps what was typed and marks the field. On a cuenta de sector the operator prompt opens at that save
 * (`useFormSubmit`'s `accion`), not on every keystroke.
 */
import { useActionState, useId, useRef, useState } from "react";
import { useFormSubmit } from "@/shared/ui/use-form-submit";
import { guardarExcipienteAction } from "./actions";
import { IDLE_STATE } from "./action-state";
import { EXCIPIENTE_MAX } from "../domain/formula-prescripcion";

export function ExcipienteField({ preparacionId, inicial }: { preparacionId: string; inicial: string | null }) {
  const [state, formAction, isPending] = useActionState(guardarExcipienteAction, IDLE_STATE);
  const { onSubmit } = useFormSubmit(formAction, { estado: state, accion: "preparaciones.confirmar" });
  const [valor, setValor] = useState(inicial ?? "");
  const guardado = useRef(inicial ?? "");
  const formRef = useRef<HTMLFormElement>(null);
  const id = useId();

  function guardar() {
    // After a failed save the same value is sent again.
    if (state.status !== "error" && valor.trim() === guardado.current.trim()) return;
    guardado.current = valor;
    formRef.current?.requestSubmit();
  }

  const error = state.status === "error" ? state.message : null;

  return (
    <form ref={formRef} action={formAction} onSubmit={onSubmit} className="field max-w-md">
      <input type="hidden" name="preparacionId" value={preparacionId} />
      <label htmlFor={id} className="field-label">
        Excipiente utilizado <span className="font-normal text-zinc-500">(opcional)</span>
      </label>
      <input
        id={id}
        name="excipiente"
        value={valor}
        maxLength={EXCIPIENTE_MAX}
        placeholder="Ej.: Ludipress"
        aria-invalid={error ? true : undefined}
        aria-describedby={`${id}-ayuda`}
        onChange={(e) => setValor(e.target.value)}
        onBlur={guardar}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            guardar();
          }
        }}
        className="input"
      />
      <p id={`${id}-ayuda`} className={error ? "field-help text-red-700" : "field-help"} aria-live="polite">
        {error ?? (isPending ? "Guardando…" : state.status === "success" ? "Guardado. Figura en el libro recetario al imprimir las etiquetas." : "Si lo completás, figura en el libro recetario.")}
      </p>
    </form>
  );
}
