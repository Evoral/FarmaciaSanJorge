"use client";

/**
 * Starts a preparación on a ficha técnica (`preparaciones.iniciar`): the "Preparar" button of the ficha técnica screen
 * (the toma workspace creates and confirms in one step instead, ./continuar-preparacion-dialog.tsx). On success,
 * navigates straight to the new preparación's screen (partidas, enrase, confirmation); an error shows inline.
 */
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { iniciarPreparacionAction } from "./actions";

export interface IniciarPreparacionFormProps {
  fichaTecnicaId: string;
  /** Default "Preparar". */
  label?: string;
  /** Default "Preparando…". */
  pendingLabel?: string;
  /** `"sm"` in table rows. */
  size?: "sm";
}

export function IniciarPreparacionForm({ fichaTecnicaId, label = "Preparar", pendingLabel = "Preparando…", size }: IniciarPreparacionFormProps) {
  const router = useRouter();
  return (
    <SimpleForm
      action={iniciarPreparacionAction}
      submitLabel={label}
      pendingLabel={pendingLabel}
      submitSize={size}
      layout="inline"
      onSuccess={(state) => {
        if (state.id) router.push(`/preparaciones/${state.id}`);
      }}
    >
      <input type="hidden" name="fichaTecnicaId" value={fichaTecnicaId} />
    </SimpleForm>
  );
}
