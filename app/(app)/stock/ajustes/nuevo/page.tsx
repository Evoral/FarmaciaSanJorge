/** `/stock/ajustes/nuevo?partidaId=...` (M07, FASE 5 point 5.4). */
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getPartida } from "@/modules/stock/application/get-partida";
import { listDtParaCoFirma } from "@/modules/stock/application/list-dt-para-co-firma";
import { NotFoundError } from "@/shared/errors";
import { AjusteForm } from "@/modules/stock/ui/ajuste-form";

interface NuevoAjustePageProps {
  searchParams: Promise<{ partidaId?: string }>;
}

export default async function NuevoAjustePage({ searchParams }: NuevoAjustePageProps) {
  const session = await requireSession();
  if (!can(session, "stock.ajuste.registrar")) {
    redirect("/stock");
  }

  const { partidaId } = await searchParams;
  if (!partidaId) {
    return (
      <div className="p-6">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Elegí una partida desde su detalle para registrar un ajuste, o buscá una droga en{" "}
          <Link href="/stock" className="underline">
            Stock
          </Link>
          .
        </p>
      </div>
    );
  }

  let partida;
  try {
    partida = await getPartida(partidaId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const dts = await listDtParaCoFirma();
  const operadorEsDt = dts.some((dt) => dt.usuarioId === session.usuario.id);

  return (
    <div className="p-6">
      <h1 className="mb-6 text-xl font-semibold">Registrar ajuste / merma</h1>
      <AjusteForm
        partidaId={partida.id}
        drogaNombre={partida.drogaNombre}
        lote={partida.lote}
        cantidadDisponible={partida.cantidadDisponible}
        dts={dts.map((dt) => ({ id: dt.usuarioId, label: `${dt.nombre} ${dt.apellido}` }))}
        operadorEsDt={operadorEsDt}
      />
    </div>
  );
}
