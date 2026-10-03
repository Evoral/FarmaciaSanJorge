/**
 * `/` -- home dashboard (FASE 13 point 13.1, user decision 1). Replaces the
 * unmodified `create-next-app` scaffold that used to sit at `app/page.tsx`
 * (deleted -- it collided with this route since route groups like `(app)`
 * don't add a URL segment). Login already redirects here
 * (`app/(auth)/login/actions.ts`'s `redirect("/")`), and this route is
 * covered by `app/(app)/layout.tsx`'s `requireSession()` guard.
 *
 * Each block renders ONLY if the session holds the permiso its own query
 * requires -- no hardcoded per-role dashboards (the gating table is
 * `shared/dashboard/cards.ts#CARD_PERMISO`, unit-tested directly). Each
 * fetch is independently try/caught (fail-soft, same discipline as the
 * banners in `app/(app)/layout.tsx`) so one failing block never breaks
 * the rest of the page.
 *
 * Layout: what needs action first (urgent before pending, with its count),
 * what is fine in a quiet column beside it, then the recetas overview
 * (the same per-estado summary as /recetas, linking into its filter).
 */
import Link from "next/link";
import { Archive, CircleCheck, FlaskConical, Inbox, Package, PackageCheck, PenLine, Users } from "lucide-react";
import type { ReactNode } from "react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getLogger } from "@/shared/logging/logger";
import { visibleDashboardCards } from "@/shared/dashboard/cards";
import { resumenJornadasPendientes } from "@/modules/cierres/application/list-jornadas-pendientes";
import { resumenDestruccion } from "@/modules/archivo/application/resumen-destruccion";
import { alertasStock } from "@/modules/stock/application/alertas-stock";
import { listRecetasEnCurso } from "@/modules/preparaciones/application/list-recetas-en-curso";
import { listEntregasPendientes } from "@/modules/entregas/application/list-entregas-pendientes";
import { resumenRecetasPorEstado } from "@/modules/recetas/application/list-recetas";
import { esEstadoTerminal } from "@/modules/recetas/domain/receta";
import { listUsuarios } from "@/modules/usuarios/application/list-usuarios";
import { ESTADO_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { estadoTone } from "@/shared/ui/status-badge";
import { PageHeader } from "@/shared/ui/page-header";
import { StatusSummary } from "@/shared/ui/status-summary";
import { SummaryList, type SummaryBreakdown, type SummaryListItem } from "@/shared/ui/summary-list";
import { EmptyState } from "@/shared/ui/empty-state";

interface Card {
  titulo: string;
  href: string;
  /** Shown when the card needs attention (the count carries the number). */
  detalle?: string;
  /** Shown when the card is fine ("Sin ..."). */
  cuerpo: string;
  cantidad: number;
  tono: "neutral" | "amber" | "red";
  icon: ReactNode;
  desglose?: SummaryBreakdown[];
}

/** Runs `fetch()` only when `visible` is true, swallowing any error into `null` (fail-soft) -- same shape as the banners in `app/(app)/layout.tsx`. */
async function fetchSoft<T>(visible: boolean, label: string, fetch: () => Promise<T>): Promise<T | null> {
  if (!visible) return null;
  try {
    return await fetch();
  } catch (error) {
    getLogger().error({ error }, `Failed to load dashboard card data: ${label}`);
    return null;
  }
}

const TONE_BY_TONO = { neutral: "success", amber: "warn", red: "danger" } as const;
const URGENCIA = { red: 0, amber: 1, neutral: 2 } as const;

export default async function HomePage() {
  const session = await requireSession();
  const visible = new Set(visibleDashboardCards((permiso) => can(session, permiso)));

  const [cierres, archivo, stock, preparaciones, entregas, recetas, usuariosPendientes, usuariosSuspendidos] = await Promise.all([
    fetchSoft(visible.has("cierresPendientes"), "cierresPendientes", () => resumenJornadasPendientes()),
    fetchSoft(visible.has("archivoPlazoCumplido"), "archivoPlazoCumplido", () => resumenDestruccion()),
    fetchSoft(visible.has("stockAlertas"), "stockAlertas", () => alertasStock()),
    fetchSoft(visible.has("preparacionesIniciadas"), "preparacionesIniciadas", () => listRecetasEnCurso({ page: 1, pageSize: 1 })),
    fetchSoft(visible.has("entregasPendientes"), "entregasPendientes", () => listEntregasPendientes({ page: 1, pageSize: 1 })),
    fetchSoft(visible.has("recetasPorEstado"), "recetasPorEstado", () => resumenRecetasPorEstado()),
    fetchSoft(visible.has("usuariosPendientes"), "usuariosPendientes", () => listUsuarios({ estado: "PENDIENTE_ACTIVACION", page: 1, pageSize: 1 })),
    fetchSoft(visible.has("usuariosPendientes"), "usuariosSuspendidos", () => listUsuarios({ estado: "SUSPENDIDO", page: 1, pageSize: 1 })),
  ]);

  const cards: Card[] = [];

  if (cierres) {
    const fueraDeTermino = Boolean(cierres.masAntigua?.fueraDeTermino);
    cards.push({
      titulo: "Jornadas pendientes de firma",
      href: "/cierres",
      cuerpo: "Sin jornadas pendientes.",
      detalle: fueraDeTermino ? "La más antigua está fuera de término." : "Jornadas cerradas a la espera de firma.",
      cantidad: cierres.cantidad,
      tono: cierres.cantidad === 0 ? "neutral" : fueraDeTermino ? "red" : "amber",
      icon: <PenLine />,
    });
  }

  if (archivo) {
    cards.push({
      titulo: "Lotes con plazo cumplido",
      href: "/archivo",
      cuerpo: "Sin lotes con plazo cumplido.",
      detalle: "Pendientes de destrucción.",
      cantidad: archivo.cantidad,
      tono: archivo.cantidad === 0 ? "neutral" : "amber",
      icon: <Archive />,
    });
  }

  if (stock) {
    const total = stock.bajoMinimo.length + stock.porVencer.length + stock.vencidasConSaldo.length;
    cards.push({
      titulo: "Alertas de stock",
      href: "/stock",
      cuerpo: "Sin alertas de stock.",
      cantidad: total,
      tono: total === 0 ? "neutral" : stock.vencidasConSaldo.length > 0 ? "red" : "amber",
      icon: <Package />,
      desglose: [
        { label: "bajo mínimo", value: stock.bajoMinimo.length, tone: "warn" as const },
        { label: "por vencer", value: stock.porVencer.length, tone: "warn" as const },
        { label: "vencidas con saldo", value: stock.vencidasConSaldo.length, tone: "danger" as const },
      ].filter((part) => part.value > 0),
    });
  }

  if (preparaciones) {
    cards.push({
      titulo: "Recetas en curso en el laboratorio",
      href: "/preparaciones?estado=INICIADA",
      cuerpo: "Sin recetas en curso en el laboratorio.",
      detalle: "Preparaciones iniciadas.",
      cantidad: preparaciones.total,
      tono: preparaciones.total === 0 ? "neutral" : "amber",
      icon: <FlaskConical />,
    });
  }

  if (entregas) {
    cards.push({
      titulo: "Entregas pendientes",
      href: "/entregas",
      cuerpo: "Sin entregas pendientes.",
      detalle: "Listas para retirar o pendientes de firma.",
      cantidad: entregas.total,
      tono: entregas.total === 0 ? "neutral" : "amber",
      icon: <PackageCheck />,
    });
  }

  if (usuariosPendientes || usuariosSuspendidos) {
    const pendientes = usuariosPendientes?.total ?? 0;
    const suspendidos = usuariosSuspendidos?.total ?? 0;
    cards.push({
      titulo: "Usuarios",
      href: "/admin/accesos/usuarios",
      cuerpo: "Sin usuarios pendientes ni suspendidos.",
      cantidad: pendientes + suspendidos,
      tono: pendientes === 0 && suspendidos === 0 ? "neutral" : "amber",
      icon: <Users />,
      desglose: [
        { label: pendientes === 1 ? "pendiente de activación" : "pendientes de activación", value: pendientes, tone: "warn" as const },
        { label: suspendidos === 1 ? "suspendido" : "suspendidos", value: suspendidos, tone: "danger" as const },
      ].filter((part) => part.value > 0),
    });
  }

  const pendientes: SummaryListItem[] = cards
    .filter((card) => card.tono !== "neutral")
    .sort((a, b) => URGENCIA[a.tono] - URGENCIA[b.tono])
    .map((card) => ({
      key: card.titulo,
      title: card.titulo,
      href: card.href,
      tone: TONE_BY_TONO[card.tono],
      icon: card.icon,
      description: card.desglose ? undefined : card.detalle,
      count: card.cantidad,
      flag: card.tono === "red" ? "Urgente" : undefined,
      breakdown: card.desglose,
    }));

  const alDia: SummaryListItem[] = cards
    .filter((card) => card.tono === "neutral")
    .map((card) => ({ key: card.titulo, title: card.titulo, href: card.href, tone: "success", icon: card.icon, description: card.cuerpo }));

  // Recetas overview: "en curso" = not ENTREGADA nor ANULADA (the terminal estados), same count as before.
  const totalRecetas = recetas ? recetas.reduce((acc, r) => acc + r.cantidad, 0) : 0;
  const activas = recetas ? recetas.filter((r) => r.estado !== "ENTREGADA" && r.estado !== "ANULADA").reduce((acc, r) => acc + r.cantidad, 0) : 0;
  const numberFormat = new Intl.NumberFormat("es-AR");

  return (
    <div className="page">
      <PageHeader title="Inicio" description="Lo pendiente del laboratorio, según tus permisos." />

      {cards.length === 0 && !recetas ? (
        <div className="list-panel">
          <EmptyState icon={<Inbox className="size-5" />} title="Nada para mostrar" description="No hay información para mostrar con tus permisos actuales." />
        </div>
      ) : null}

      {cards.length > 0 ? (
        <div className={`grid gap-6 ${alDia.length > 0 ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : ""}`}>
          <section aria-labelledby="pendientes-heading">
            <div className="section-heading">
              <h2 id="pendientes-heading">Requiere atención</h2>
              {pendientes.length > 0 ? (
                <span className="text-xs text-zinc-500">
                  {pendientes.length} {pendientes.length === 1 ? "tema" : "temas"}
                </span>
              ) : null}
            </div>
            <div className="list-panel">
              {pendientes.length > 0 ? (
                <SummaryList items={pendientes} />
              ) : (
                <EmptyState icon={<CircleCheck className="size-5" />} title="Todo al día" description="No hay pendientes que requieran atención." />
              )}
            </div>
          </section>

          {alDia.length > 0 ? (
            <section aria-labelledby="al-dia-heading">
              <div className="section-heading">
                <h2 id="al-dia-heading">Al día</h2>
              </div>
              <div className="list-panel">
                <SummaryList items={alDia} variant="compact" />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {recetas ? (
        <section aria-labelledby="recetas-heading" className={cards.length > 0 ? "mt-8" : undefined}>
          <div className="section-heading">
            <h2 id="recetas-heading">Recetas</h2>
            <Link href="/recetas" className="section-link">
              Ver recetas
            </Link>
          </div>
          <StatusSummary
            label="Recetas por estado"
            unit={["receta", "recetas"]}
            headline={{
              value: activas,
              label: activas === 1 ? "receta activa" : "recetas activas",
              caption: `No entregadas ni anuladas, de ${numberFormat.format(totalRecetas)} registradas`,
            }}
            all={{ label: "Todas", count: totalRecetas, href: "/recetas", active: false }}
            items={recetas.map((r) => ({
              key: r.estado,
              label: ESTADO_RECETA_LABELS[r.estado],
              count: r.cantidad,
              href: `/recetas?estado=${r.estado}`,
              active: false,
              tone: estadoTone(r.estado),
              secondary: esEstadoTerminal(r.estado),
            }))}
          />
        </section>
      ) : null}
    </div>
  );
}
