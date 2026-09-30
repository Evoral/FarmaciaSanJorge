"use client";

/** "Preparar" button (M11): starts a preparación on a ficha técnica (`preparaciones.iniciar`), from the ficha técnica screen or the /recetas list. On success, navigates straight to the new preparación's screen; an error shows inline. */
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { iniciarPreparacionAction } from "./actions";

export interface IniciarPreparacionFormProps {
  fichaTecnicaId: string;
  /** Default "Preparar"; the list uses "Preparar ítem N de M". */
  label?: string;
  /** `"sm"` in the /recetas table rows. */
  size?: "sm";
}

export function IniciarPreparacionForm({ fichaTecnicaId, label = "Preparar", size }: IniciarPreparacionFormProps) {
  const router = useRouter();
  return (
    <SimpleForm
      action={iniciarPreparacionAction}
      submitLabel={label}
      pendingLabel="Preparando…"
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
