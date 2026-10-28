"use client";

/**
 * Logo panel of `/admin/configuracion/farmacia` (openspec/specs/logo-farmacia/spec.md): preview of what the navbar shows, upload
 * and remove. The size is pre-checked here only for a clearer message -- the server's trust boundary
 * (../domain/logo.ts) is the real check. On success `SimpleForm` refreshes the route, so the navbar picks up the new
 * logo right away.
 */
import Image from "next/image";
import { useState, type ChangeEvent } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { ACCEPT_LOGO, MAX_LOGO_BYTES, MENSAJES_LOGO } from "../domain/logo";
import { cambiarLogoTenantAction, quitarLogoTenantAction } from "./actions";

export interface LogoTenantFormProps {
  /** The tenant's logo URL, or `null` when it has none (the generic one is shown). */
  logoSrc: string | null;
  disabled: boolean;
}

export function LogoTenantForm({ logoSrc, disabled }: LogoTenantFormProps) {
  const [clientError, setClientError] = useState<string | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const archivo = e.target.files?.[0];
    if (archivo && archivo.size > MAX_LOGO_BYTES) {
      setClientError(MENSAJES_LOGO.demasiadoGrande);
      e.target.value = "";
      return;
    }
    setClientError(null);
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="flex shrink-0 flex-col items-center gap-1.5">
        <span className="flex size-20 items-center justify-center rounded-md border border-zinc-200 bg-white p-2">
          {/* `unoptimized`: the per-tenant image sits behind the session cookie, which the image optimizer would not send. */}
          <Image src={logoSrc ?? "/logo.png"} alt={logoSrc ? "Logo actual de la farmacia" : "Logo genérico"} width={64} height={64} unoptimized className="size-16 object-contain" />
        </span>
        <span className="text-xs text-zinc-500">{logoSrc ? "Logo propio" : "Genérico"}</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <SimpleForm action={cambiarLogoTenantAction} submitLabel="Subir logo" pendingLabel="Subiendo…" submitDisabled={disabled}>
          <div className="field">
            <label htmlFor="tenant-logo" className="field-label">
              Imagen <span className="font-normal text-zinc-500">(PNG, JPG o WebP, hasta {MAX_LOGO_BYTES / 1024} KB)</span>
            </label>
            <input id="tenant-logo" name="logo" type="file" accept={ACCEPT_LOGO} required disabled={disabled} onChange={handleChange} className="input" />
            <p className="field-help">Se muestra arriba en la barra de navegación. Conviene una imagen cuadrada con fondo transparente.</p>
            {clientError ? (
              <p role="alert" className="text-xs text-red-700">
                {clientError}
              </p>
            ) : null}
          </div>
        </SimpleForm>
        {logoSrc ? <SimpleForm action={quitarLogoTenantAction} submitLabel="Quitar logo" pendingLabel="Quitando…" submitVariant="secondary" submitDisabled={disabled} /> : null}
      </div>
    </div>
  );
}
