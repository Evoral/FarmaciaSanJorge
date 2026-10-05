"use client";

/**
 * Create/edit form for a role (DP-03, `/admin/accesos/roles/nuevo` and
 * `/admin/accesos/roles/[id]`). Permisos are grouped by module (prefix
 * before the first dot) with their human description, plus a per-module
 * "select all" toggle. Checkbox state is CONTROLLED (a `Set`), so neither
 * React 19's form auto-reset nor a failed submit loses the selection.
 *
 * Each permiso shows its category (operativo / consulta / gestión) as a
 * small badge; each module card shows how many of its permisos are on.
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
import { ToneBadge } from "@/shared/ui/status-badge";
import type { BadgeTone } from "@/shared/ui/status-badge";
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
      <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div className="field">
          <label htmlFor={nombreId} className="field-label">
            Nombre
          </label>
          <input id={nombreId} name="nombre" required maxLength={NOMBRE_ROL_MAX} defaultValue={rol?.nombre ?? ""} disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor={descripcionId} className="field-label">
            Descripción <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <textarea id={descripcionId} name="descripcion" rows={2} maxLength={DESCRIPCION_ROL_MAX} defaultValue={rol?.descripcion ?? ""} disabled={disabled} className="input" />
        </div>
      </div>

      <fieldset className="flex flex-col gap-3" aria-describedby={`${nombreId}-permisos-ayuda`}>
        <legend className="field-label">Permisos</legend>
        <p id={`${nombreId}-permisos-ayuda`} className="field-help -mt-1">
          Los permisos de sesión se incluyen siempre. Los permisos que vos no podés otorgar aparecen deshabilitados: no los podés agregar ni quitar.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          {grupos.map((grupo) => {
            const editables = grupo.permisos.map((p) => p.codigo).filter(editable);
            const todosMarcados = editables.length > 0 && editables.every((codigo) => seleccion.has(codigo));
            const marcados = grupo.permisos.filter((p) => seleccion.has(p.codigo)).length;
            return (
              <div key={grupo.grupo} className="group-card">
                <div className="group-card-header justify-between">
                  <h3 className="flex items-center gap-2 text-[0.8125rem] font-semibold text-zinc-900">
                    {grupo.etiqueta}
                    <span className="font-mono text-xs font-normal tabular-nums text-zinc-500" title={`${marcados} de ${grupo.permisos.length} permisos`}>
                      {marcados}/{grupo.permisos.length}
                    </span>
                  </h3>
                  {editables.length > 0 ? (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={todosMarcados}
                        onChange={(event) => toggleGrupo(editables, event.target.checked)}
                        aria-label={`Seleccionar todos los permisos de ${grupo.etiqueta}`}
                      />
                      Todos
                    </label>
                  ) : null}
                </div>
                <ul className="flex flex-col divide-y divide-zinc-100">
                  {grupo.permisos.map((permiso) => {
                    const habilitado = editable(permiso.codigo);
                    return (
                      <li key={permiso.codigo}>
                        <label className={`flex items-start gap-2.5 px-3 py-2 text-[0.8125rem] ${habilitado ? "cursor-pointer hover:bg-zinc-50" : "text-zinc-500"}`}>
                          <input
                            type="checkbox"
                            name="permisos"
                            value={permiso.codigo}
                            className="mt-0.5 size-4 flex-none"
                            checked={seleccion.has(permiso.codigo)}
                            disabled={!habilitado}
                            onChange={(event) => toggle(permiso.codigo, event.target.checked)}
                          />
                          <span className="min-w-0 flex-1">
                            <span className={habilitado ? "text-zinc-900" : undefined}>{permiso.descripcion}</span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="font-mono text-[0.6875rem] text-zinc-400">{permiso.codigo}</span>
                              {BASE.has(permiso.codigo) ? <span className="text-xs text-zinc-500">(siempre incluido)</span> : null}
                            </span>
                          </span>
                          <CategoriaBadge categoria={permiso.categoria} />
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </fieldset>
    </>
  );

  if (disabled) {
    return <div className="flex flex-col gap-5">{fields}</div>;
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

const CATEGORIA_TONE: Record<PermisoCatalogo["categoria"], BadgeTone> = {
  operativo: "warn",
  consulta: "neutral",
  gestion: "success",
  sistema: "neutral",
};

/** Small category badge next to each permiso (operativo / consulta / gestión). */
export function CategoriaBadge({ categoria }: { categoria: PermisoCatalogo["categoria"] }) {
  return <ToneBadge tone={CATEGORIA_TONE[categoria]}>{CATEGORIA_PERMISO_LABELS[categoria]}</ToneBadge>;
}
