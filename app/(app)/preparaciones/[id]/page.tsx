/**
 * `/preparaciones/[id]` (M11, FASE 8 point 8.2/8.3/8.5): the preparación screen -- pantalla de preparación, confirmación
 * (irreversible, escribe en el libro recetario) o resumen final.
 *
 * Layout: a focused single column (the confirmation is a sequential review, línea by línea), with the irreversible
 * warning first and the "descartar" alternative last, in its own danger zone.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CircleOff, Printer, Tag } from "lucide-react";
import { NotFoundError } from "@/shared/errors";
import { getPreparacionParaPantalla } from "@/modules/preparaciones/application/get-preparacion-para-pantalla";
import { getEtiquetaParaImprimir } from "@/modules/preparaciones/application/get-etiqueta-para-imprimir";
import { ConfirmarPreparacionForm } from "@/modules/preparaciones/ui/confirmar-form";
import { DescartarPreparacionForm } from "@/modules/preparaciones/ui/descartar-form";
import { SimpleForm } from "@/shared/ui/simple-form";
import { generarEtiquetaAction } from "@/modules/preparaciones/ui/actions";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { StatusBadge } from "@/shared/ui/status-badge";

interface PreparacionPageProps {
  params: Promise<{ id: string }>;
}

const TITULO: Record<string, string> = {
  INICIADA: "Confirmar preparación",
  CONFIRMADA: "Preparación confirmada",
  DESCARTADA: "Preparación descartada",
};

export default async function PreparacionPage({ params }: PreparacionPageProps) {
  const { id } = await params;

  let pantalla;
  try {
    pantalla = await getPreparacionParaPantalla(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  // Back to the receta's toma workspace while it has ítems to confirm, else the tab that lists this preparación.
  const vuelveALaToma = pantalla.hrefVolver.startsWith("/preparaciones/recetas/");

  return (
    <div className="page">
      <div className="mx-auto max-w-4xl">
        <PageHeader
          breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Preparaciones", href: "/preparaciones" }, { label: "Preparación" }]}
          title={
            <span className="flex flex-wrap items-center gap-3">
              {TITULO[pantalla.estado] ?? "Preparación"}
              <StatusBadge estado={pantalla.estado} />
            </span>
          }
          description={
            pantalla.estado === "INICIADA"
              ? `Revisá las partidas de cada línea (${pantalla.lineas.length}) y confirmá. Se pide reautenticación.`
              : undefined
          }
          actions={
            <Link href={pantalla.hrefVolver} className="btn btn-secondary">
              <ArrowLeft className="size-4" aria-hidden />
              {vuelveALaToma ? "Volver a la receta" : "Volver a preparaciones"}
            </Link>
          }
        />

        {pantalla.estado === "INICIADA" ? (
          <div className="flex flex-col gap-8">
            <ConfirmarPreparacionForm pantalla={pantalla} />
            <section className="panel" data-tone="danger" aria-labelledby="descartar-heading">
              <div className="panel-header">
                <h2 id="descartar-heading">Descartar en lugar de confirmar</h2>
              </div>
              <div className="panel-body">
                <DescartarPreparacionForm preparacionId={pantalla.id} />
              </div>
            </section>
          </div>
        ) : null}

        {pantalla.estado === "CONFIRMADA" ? <EtiquetaSeccion preparacionId={pantalla.id} /> : null}

        {pantalla.estado === "DESCARTADA" ? (
          <section className="panel">
            <EmptyState icon={<CircleOff className="size-5" />} title="Esta preparación fue descartada" description="No afectó el stock ni el libro recetario." />
          </section>
        ) : null}
      </div>
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
    <section className="panel" aria-labelledby="etiqueta-heading">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
        <span className="tone-tile" data-tone={etiqueta ? "success" : "warn"} aria-hidden>
          <Tag />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="etiqueta-heading" className="text-[0.9375rem] font-semibold text-zinc-900">
            Etiqueta
          </h2>
          <p className="text-[0.8125rem] text-zinc-500">{etiqueta ? "La etiqueta está generada y lista para imprimir." : "Falta generar la etiqueta de esta preparación."}</p>
        </div>
        {etiqueta ? (
          <a href={`/api/preparaciones/${preparacionId}/etiqueta/pdf`} target="_blank" rel="noreferrer" className="btn btn-primary">
            <Printer className="size-4" aria-hidden />
            Imprimir etiqueta
          </a>
        ) : (
          <SimpleForm action={generarEtiquetaAction} submitLabel="Generar etiqueta" pendingLabel="Generando…">
            <input type="hidden" name="preparacionId" value={preparacionId} />
          </SimpleForm>
        )}
      </div>
    </section>
  );
}
