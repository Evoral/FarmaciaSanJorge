"use client";

/** "Iniciar preparación" button (M11, FASE 8 point 8.1), placed on the ficha técnica screen. On success, navigates straight to the new preparación's screen. */
import { useRouter } from "next/navigation";
import { SimpleForm } from "./simple-form";
import { iniciarPreparacionAction } from "./actions";

export interface IniciarPreparacionFormProps {
  fichaTecnicaId: string;
}

export function IniciarPreparacionForm({ fichaTecnicaId }: IniciarPreparacionFormProps) {
  const router = useRouter();
  return (
    <SimpleForm
      action={iniciarPreparacionAction}
      submitLabel="Iniciar preparación"
      pendingLabel="Iniciando…"
      onSuccess={(state) => {
        if (state.id) router.push(`/preparaciones/${state.id}`);
      }}
    >
      <input type="hidden" name="fichaTecnicaId" value={fichaTecnicaId} />
    </SimpleForm>
  );
}
