/** `/regularizacion` (FASE 11 point 11.3, DP-15, INV-R10): recetas asentadas sin receta física recibida, ordenadas por antigüedad, con alerta de vencidas. Paciente search goes through `RegularizacionBuscador` (POST Server Action, DP-24). */
import Link from "next/link";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listRegularizacion } from "@/modules/entregas/application/list-regularizacion";
import { RegularizacionBuscador } from "@/modules/entregas/ui/regularizacion-buscador";

const PAGE_SIZE = 20;

export default async function RegularizacionPage() {
  const session = await requireSession();
  const result = await listRegularizacion({ soloVencidas: false, page: 1, pageSize: PAGE_SIZE });

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Regularización</h1>
        {can(session, "entregas.registrar") ? (
          <Link href="/entregas" className="text-sm underline">
            Ver entregas
          </Link>
        ) : null}
      </div>
      <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">
        Recetas con al menos un asiento (ya dispensadas) que todavía no tienen registrada la recepción de la receta física
        (INV-R10), ordenadas de más a menos antiguas. Se marcan &quot;vencidas&quot; una vez superado el plazo de regularización.
      </p>

      <RegularizacionBuscador itemsIniciales={result.items} totalInicial={result.total} plazoRegularizacionDias={result.plazoRegularizacionDias} />
    </div>
  );
}
