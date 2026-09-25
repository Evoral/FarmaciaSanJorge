/** `/preparaciones/[id]` (M11, FASE 8 point 8.2/8.3/8.5): the preparación screen -- pantalla de preparación, confirmación (irreversible, escribe en el libro recetario) o resumen final. */
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/shared/errors";
import { getPreparacionParaPantalla } from "@/modules/preparaciones/application/get-preparacion-para-pantalla";
import { getEtiquetaParaImprimir } from "@/modules/preparaciones/application/get-etiqueta-para-imprimir";
import { ConfirmarPreparacionForm } from "@/modules/preparaciones/ui/confirmar-form";
import { DescartarPreparacionForm } from "@/modules/preparaciones/ui/descartar-form";
import { SimpleForm } from "@/modules/preparaciones/ui/simple-form";
import { generarEtiquetaAction } from "@/modules/preparaciones/ui/actions";

interface PreparacionPageProps {
  params: Promise<{ id: string }>;
}

export default async function PreparacionPage({ params }: PreparacionPageProps) {
  const { id } = await params;

  let pantalla;
  try {
    pantalla = await getPreparacionParaPantalla(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="page">
      <div className="mb-4">
        <Link href="/preparaciones" className="text-sm underline">
          ← Volver a preparaciones
        </Link>
      </div>

      <h1 className="mb-4 text-2xl font-semibold">Preparación — {pantalla.estado}</h1>

      {pantalla.estado === "INICIADA" ? (
        <>
          <ConfirmarPreparacionForm pantalla={pantalla} />
          <div className="mt-8 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <h2 className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">Descartar en lugar de confirmar</h2>
            <DescartarPreparacionForm preparacionId={pantalla.id} />
          </div>
        </>
      ) : null}

      {pantalla.estado === "CONFIRMADA" ? <EtiquetaSeccion preparacionId={pantalla.id} /> : null}

      {pantalla.estado === "DESCARTADA" ? <p className="text-sm text-zinc-600 dark:text-zinc-400">Esta preparación fue descartada. No afectó el stock ni el libro recetario.</p> : null}
    </div>
  );
}

async function EtiquetaSeccion({ preparacionId }: { preparacionId: string }) {
  let etiqueta: { etiquetaId: string } | null = null;
  try {
    const datos = await getEtiquetaParaImprimir(preparacionId);
    etiqueta = { etiquetaId: datos.etiquetaId };
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }

  return (
    <section className="mt-4">
      <h2 className="mb-2 text-lg font-medium">Etiqueta</h2>
      {etiqueta ? (
        <a
          href={`/api/preparaciones/${preparacionId}/etiqueta/pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-block btn btn-secondary"
        >
          Imprimir etiqueta
        </a>
      ) : (
        <SimpleForm action={generarEtiquetaAction} submitLabel="Generar etiqueta" pendingLabel="Generando…">
          <input type="hidden" name="preparacionId" value={preparacionId} />
        </SimpleForm>
      )}
    </section>
  );
}
