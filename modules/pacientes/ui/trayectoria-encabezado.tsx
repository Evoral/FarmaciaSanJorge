/**
 * Header of `/pacientes/[id]/trayectoria`: apellido, nombre, DNI, nro. de
 * credencial and estado (vigente / dado de baja + motivo). Server component.
 * HEALTH-ADJACENT DATA (DP-24, Ley 25.326): rendered only for sessions that
 * passed `pacientes.gestionar`; none of these values may go into a URL or a log.
 */
import { StatusBadge } from "@/shared/ui/status-badge";
import type { PacienteTrayectoria } from "../domain/trayectoria";

export function TrayectoriaEncabezado({ paciente }: { paciente: PacienteTrayectoria }) {
  return (
    <header className="mb-6">
      <h1 className="text-2xl font-semibold">
        {paciente.apellido}, {paciente.nombre}
      </h1>
      <dl className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">DNI</dt>
          <dd>{paciente.dni ?? "—"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">Nº de credencial</dt>
          <dd>{paciente.nroCredencial ?? "—"}</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <dt className="text-zinc-500">Estado</dt>
          <dd>
            <StatusBadge estado={paciente.fechaBaja ? "BAJA" : "VIGENTE"} />
          </dd>
        </div>
        {paciente.fechaBaja ? (
          <div className="flex items-center gap-1.5">
            <dt className="text-zinc-500">Motivo de baja</dt>
            <dd>{paciente.motivoBaja ?? "—"}</dd>
          </div>
        ) : null}
      </dl>
    </header>
  );
}
