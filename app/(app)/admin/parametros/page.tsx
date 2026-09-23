/**
 * `/admin/parametros` (FASE 3 point 3.10b): lists the two known per-tenant
 * weighing parameters with an edit form each (enabled only for
 * `config.editar`).
 */
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listParametros } from "@/modules/parametros/application/list-parametros";
import { ParametroForm } from "@/modules/parametros/ui/parametro-form";

export default async function ParametrosPage() {
  const session = await requireSession();
  const parametros = await listParametros();
  const puedeEditar = can(session, "config.editar");

  return (
    <div>
      <h1 className="mb-1 text-xl font-semibold">Parámetros de la farmacia</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Estos parámetros afectan el cálculo de las líneas de pesaje de las fichas técnicas. Un cambio acá aplica SOLO a las
        fichas técnicas generadas DESPUÉS del cambio -- las fichas ya generadas quedan congeladas con los valores vigentes al
        momento de generarlas, un cambio posterior en un parámetro no las recalcula (docs/specs/ficha-tecnica.md).
      </p>

      <div className="flex max-w-md flex-col gap-4">
        {parametros.map((parametro) => (
          <ParametroForm
            key={parametro.clave}
            clave={parametro.clave}
            label={parametro.label}
            descripcion={parametro.descripcion}
            valor={parametro.valor}
            disabled={!puedeEditar}
          />
        ))}
      </div>
    </div>
  );
}
