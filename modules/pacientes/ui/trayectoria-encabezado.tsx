/**
 * Header of `/pacientes/[id]/trayectoria`: breadcrumbs back to the list, apellido, nombre, estado (vigente / dado de
 * baja + motivo), DNI and nro. de credencial. Server component. HEALTH-ADJACENT DATA (DP-24, Ley 25.326): rendered only
 * for sessions that passed `pacientes.gestionar`; none of these values may go into a URL or a log.
 */
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { PacienteTrayectoria } from "../domain/trayectoria";

export function TrayectoriaEncabezado({ paciente }: { paciente: PacienteTrayectoria }) {
  const nombre = `${paciente.apellido}, ${paciente.nombre}`;

  return (
    <PageHeader
      breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pacientes", href: "/pacientes" }, { label: nombre }]}
      title={
        <span className="flex flex-wrap items-center gap-3">
          {nombre}
          <ToneBadge tone={paciente.fechaBaja ? "neutral" : "success"}>{paciente.fechaBaja ? "Dado de baja" : "Vigente"}</ToneBadge>
        </span>
      }
      description={
        <span className="meta-line">
          <span>
            DNI <span className="font-mono text-zinc-900">{paciente.dni ?? "-"}</span>
          </span>
          <span>
            Credencial <span className="font-mono text-zinc-900">{paciente.nroCredencial ?? "-"}</span>
          </span>
          {paciente.fechaBaja ? <span>Motivo de baja: {paciente.motivoBaja ?? "sin motivo"}</span> : null}
        </span>
      }
    />
  );
}
