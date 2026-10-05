/**
 * The one-time activation credential, shown inline right after creating a usuario or resetting its credential (never
 * stored, never in a URL; see `modules/usuarios/application/crear-usuario.ts`). Presentational: the caller owns the
 * focus/role and passes the context sentence as children.
 */
import type { ReactNode, Ref } from "react";
import { KeyRound } from "lucide-react";

export interface CredencialActivacionProps {
  titulo: string;
  credencial: string;
  /** ISO timestamp of the expiry. */
  venceEn: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}

export function CredencialActivacion({ titulo, credencial, venceEn, children, ref }: CredencialActivacionProps) {
  return (
    <div ref={ref} role="alert" tabIndex={-1} className="flex flex-col gap-3 rounded-lg border-2 border-amber-400 bg-amber-50 p-4 text-amber-900 outline-none">
      <p className="flex items-center gap-2 font-semibold">
        <KeyRound className="size-4" aria-hidden />
        {titulo}
      </p>
      <p className="text-[0.8125rem]">
        Vence el <strong>{new Date(venceEn).toLocaleString("es-AR")}</strong> (72 horas). {children}
      </p>
      <code className="block select-all break-all rounded-md border border-amber-200 bg-white px-3 py-2.5 font-mono text-sm text-zinc-900">{credencial}</code>
      <p className="text-[0.8125rem]">
        No es una contraseña: la persona lo ingresa junto con su email en <span className="font-mono">/activar</span> (link «Activá tu cuenta» en la pantalla de
        inicio de sesión) para elegir su contraseña.
      </p>
    </div>
  );
}
