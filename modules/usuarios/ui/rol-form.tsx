"use client";

/**
 * Create/edit form for a role (DP-03, `/admin/accesos/roles/nuevo` and
 * `/admin/accesos/roles/[id]`). Permisos are grouped by module (prefix
 * before the first dot) with their human description, plus a per-module
 * "select all" toggle. Checkbox state is CONTROLLED (a `Set`), so neither
 * React 19's form auto-reset nor a failed submit loses the selection.
 *
 * Each permiso shows its category (operativo / consulta / gestión) as a
 * small badge.
 *
 * Disabled (never submitted) checkboxes:
 *   - permisos outside the ACTOR's grantable set (held permisos, plus every
 *     operativo one for an ADMINISTRADOR) -- they cannot grant or remove
 *     them (escalation rule; the command keeps them as they are);
 *   - the session basics (`PERMISOS_BASE_DE_ROL`), always included.
 * Both are UX only: the command re-applies the same rules server-side.
 */
import { useId, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";
import { PERMISOS_BASE_DE_ROL, type Permiso } from "@/modules/auth/domain/permisos";
import { agruparPermisos, CATEGORIA_PERMISO_LABELS, DESCRIPCION_ROL_MAX, NOMBRE_ROL_MAX, type PermisoCatalogo } from "../domain/roles";
import { crearRolAction, editarRolAction } from "./rol-actions";

const BASE: ReadonlySet<string> = new Set(PERMISOS_BASE_DE_ROL);

export interface RolFormProps {
  /** Absent = create. */
  rol?: { id: string; nombre: string; descripcion: string | null; permisos: readonly Permiso[] };
  catalogo: readonly PermisoCatalogo[];
  /** The ACTOR's grantable permisos (computed server-side, see modules/usuarios/application/roles-asignables.ts). */
  otorgables: readonly string[];
  /** Read-only rendering (no `roles.gestionar`, or a role the actor holds). */
  disabled?: boolean;
}

export function RolForm({ rol, catalogo, otorgables, disabled = false }: RolFormProps) {
  const router = useRouter();
  const nombreId = useId();
  const descripcionId = useId();
  const grupos = useMemo(() => agruparPermisos(catalogo), [catalogo]);
  const otorgablesSet = useMemo(() => new Set(otorgables), [otorgables]);
  const [seleccion, setSeleccion] = useState<Set<string>>(() => new Set([...(rol?.permisos ?? []), ...PERMISOS_BASE_DE_ROL]));

  const editable = (codigo: string) => !disabled && !BASE.has(codigo) && otorgablesSet.has(codigo);

  function toggle(codigo: string, checked: boolean) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (checked) next.add(codigo);
      else next.delete(codigo);
      return next;
    });
  }

  function toggleGrupo(codigos: readonly string[], checked: boolean) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      for (const codigo of codigos) {
        if (checked) next.add(codigo);
        else next.delete(codigo);
      }
      return next;
    });
  }

  const fields = (
    <>
      {rol ? <input type="hidden" name="rolId" value={rol.id} /> : null}
      <div className="flex flex-col gap-1">
        <label htmlFor={nombreId} className="text-sm font-medium">
          Nombre
        </label>
        <input id={nombreId} name="nombre" required maxLength={NOMBRE_ROL_MAX} defaultValue={rol?.nombre ?? ""} disabled={disabled} className="input" />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={descripcionId} className="text-sm font-medium">
          Descripción (opcional)
        </label>
        <textarea
          id={descripcionId}
          name="descripcion"
          rows={2}
          maxLength={DESCRIPCION_ROL_MAX}
          defaultValue={rol?.descripcion ?? ""}
          disabled={disabled}
          className="input"
        />
      </div>

      <fieldset className="flex flex-col gap-4" aria-describedby={`${nombreId}-permisos-ayuda`}>
        <legend className="text-sm font-medium">Permisos</legend>
        <p id={`${nombreId}-permisos-ayuda`} className="text-xs text-zinc-500">
          Los permisos de sesión se incluyen siempre. Los permisos que vos no podés otorgar aparecen deshabilitados: no los podés
          agregar ni quitar.
        </p>
        {grupos.map((grupo) => {
          const editables = grupo.permisos.map((p) => p.codigo).filter(editable);
          const todosMarcados = editables.length > 0 && editables.every((codigo) => seleccion.has(codigo));
          return (
            <div key={grupo.grupo} className="card p-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">{grupo.etiqueta}</h3>
                {editables.length > 0 ? (
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={todosMarcados}
                      onChange={(event) => toggleGrupo(editables, event.target.checked)}
                      aria-label={`Seleccionar todos los permisos de ${grupo.etiqueta}`}
                    />
                    Todos
                  </label>
                ) : null}
              </div>
              <ul className="flex flex-col gap-1">
                {grupo.permisos.map((permiso) => {
                  const habilitado = editable(permiso.codigo);
                  return (
                    <li key={permiso.codigo}>
                      <label className={`flex items-start gap-2 text-sm ${habilitado ? "" : "text-zinc-500"}`}>
                        <input
                          type="checkbox"
                          name="permisos"
                          value={permiso.codigo}
                          className="mt-0.5 h-4 w-4"
                          checked={seleccion.has(permiso.codigo)}
                          disabled={!habilitado}
                          onChange={(event) => toggle(permiso.codigo, event.target.checked)}
                        />
                        <span>
                          {permiso.descripcion}
                          <CategoriaBadge categoria={permiso.categoria} />
                          <span className="ml-2 font-mono text-xs text-zinc-400">{permiso.codigo}</span>
                          {BASE.has(permiso.codigo) ? <span className="ml-2 text-xs text-zinc-500">(siempre incluido)</span> : null}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </fieldset>
    </>
  );

  if (disabled) {
    return <div className="flex flex-col gap-4">{fields}</div>;
  }

  return (
    <ReauthAwareForm
      action={rol ? editarRolAction : crearRolAction}
      submitLabel={rol ? "Guardar cambios" : "Crear rol"}
      pendingLabel="Guardando…"
      onSuccess={(state) => {
        if (!rol && state.rolId) router.push(`/admin/accesos/roles/${state.rolId}`);
      }}
    >
      {fields}
    </ReauthAwareForm>
  );
}

const CATEGORIA_BADGE_CLASS: Record<PermisoCatalogo["categoria"], string> = {
  operativo: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  consulta: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  gestion: "bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  sistema: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

/** Small category badge next to each permiso (operativo / consulta / gestión). */
export function CategoriaBadge({ categoria }: { categoria: PermisoCatalogo["categoria"] }) {
  return <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${CATEGORIA_BADGE_CLASS[categoria]}`}>{CATEGORIA_PERMISO_LABELS[categoria]}</span>;
}
