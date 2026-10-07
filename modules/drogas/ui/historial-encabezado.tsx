/**
 * Header of `/catalogos/drogas/[id]/historial`: breadcrumbs
 * `Inicio › Catálogos › Drogas › <droga> › Historial`, the droga's name and its
 * vigente / dada de baja badge (same title as the Datos tab). Server component.
 * Rendered only for sessions that passed the use case's `recetas.crear` gate.
 */
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { DrogaHistorial } from "../domain/historial";

export function HistorialEncabezado({ droga }: { droga: DrogaHistorial }) {
  return (
    <PageHeader
      breadcrumbs={[
        { label: "Inicio", href: "/" },
        { label: "Catálogos" },
        { label: "Drogas", href: "/catalogos/drogas" },
        { label: droga.nombre, href: `/catalogos/drogas/${droga.id}` },
        { label: "Historial" },
      ]}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {droga.nombre}
          <ToneBadge tone={droga.fechaBaja ? "neutral" : "success"}>{droga.fechaBaja ? "Dada de baja" : "Vigente"}</ToneBadge>
        </span>
      }
      description="Recetas que consumieron esta droga y de qué partida salió."
    />
  );
}
