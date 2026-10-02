"use client";

/**
 * "Eliminar rol" with an explicit confirmation step (DP-03): the button only
 * reveals a confirm card; the actual delete is a re-auth-aware submit. The
 * page renders this only for a deletable, unassigned role -- the command
 * re-checks both (and the DB triggers INV-ROL-002..004 are the backstop).
 */
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { CollapsibleActionCard } from "@/shared/ui/motivo-form";
import { eliminarRolAction } from "./rol-actions";

export function EliminarRolForm({ rolId, nombre }: { rolId: string; nombre: string }) {
  const router = useRouter();
  return (
    <CollapsibleActionCard
      label="Eliminar rol"
      helpText={`Se elimina el rol "${nombre}" de forma definitiva. Queda registrado en la auditoría.`}
      variant="danger"
      className="max-w-md"
    >
      {({ cancelButton }) => (
        <ReauthAwareForm
          action={eliminarRolAction}
          submitLabel="Sí, eliminar"
          pendingLabel="Eliminando…"
          submitVariant="danger"
          extraActions={cancelButton}
          onSuccess={() => router.push("/admin/accesos/roles")}
        >
          <input type="hidden" name="rolId" value={rolId} />
        </ReauthAwareForm>
      )}
    </CollapsibleActionCard>
  );
}
