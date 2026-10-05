/**
 * `/reportes` (FASE 13 point 13.1/13.4, user decision 5). Hub listing every
 * report the session can access -- each entry gated by the SAME permiso its
 * target page/query enforces, no hardcoded per-role list. ADM deliberately
 * has no `reportes.ver` (no patient data), so it sees only the auditoría
 * entry it already has permisos for. The usuarios listing is NOT a report
 * entry: it lives under the sidebar's "Administración › Usuarios y
 * accesos" (`/admin/accesos/usuarios`).
 */
import { ArrowLeftRight, ClipboardList, Coins, FileSignature, FileText, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { SummaryList } from "@/shared/ui/summary-list";

interface ReporteEntry {
  href: string;
  titulo: string;
  descripcion: string;
  icon: ReactNode;
}

export default async function ReportesPage() {
  const session = await requireSession();

  const entries: ReporteEntry[] = [];
  if (can(session, "reportes.ver")) {
    entries.push({ href: "/reportes/recetas", titulo: "Recetas por estado", descripcion: "Conteos por estado y listado filtrado por fecha de ingreso.", icon: <ClipboardList /> });
  }
  if (can(session, "stock.valorizado.ver")) {
    entries.push({ href: "/reportes/stock-valorizado", titulo: "Stock valorizado", descripcion: "Valorizado al costo actual de cada partida, con subtotales por droga.", icon: <Coins /> });
  }
  if (can(session, "stock.ver")) {
    entries.push({ href: "/reportes/kardex", titulo: "Kardex de movimientos", descripcion: "Movimientos de stock filtrables por droga, tipo y rango de fechas.", icon: <ArrowLeftRight /> });
  }
  if (can(session, "cierres.reporte")) {
    entries.push({ href: "/cierres/reporte", titulo: "Cumplimiento de firma de cierres", descripcion: "Demora, fuera de término y motivo por jornada firmada.", icon: <FileSignature /> });
  }
  if (can(session, "reportes.auditoria") || can(session, "auditoria.ver")) {
    entries.push({ href: "/auditoria", titulo: "Auditoría", descripcion: "Registro de acciones auditadas de la farmacia.", icon: <ShieldCheck /> });
  }

  return (
    <div className="page">
      <PageHeader breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Reportes" }]} title="Reportes" description="Consultas y exportaciones de la farmacia." />

      <div className="list-panel max-w-3xl">
        {entries.length === 0 ? (
          <EmptyState icon={<FileText className="size-5" />} title="Sin reportes disponibles" description="No tenés permisos para ver ningún reporte." />
        ) : (
          <SummaryList
            items={entries.map((entry) => ({ key: entry.href, title: entry.titulo, description: entry.descripcion, href: entry.href, tone: "neutral", icon: entry.icon }))}
          />
        )}
      </div>
    </div>
  );
}
