/**
 * "Métodos de verificación" (openspec/specs/cuentas-de-sector/spec.md): which OPTIONAL methods an empleado can use to
 * identify themselves in a cuenta de sector. Configured per farmacia; the PIN is always on (code), so only the methods
 * of `METODOS_OPCIONALES` can be switched. Pure -- no I/O.
 */
import { METODOS, METODOS_OPCIONALES, type MetodoVerificacion } from "@/modules/auth/domain/verificacion-identidad";

/** One optional method as the configuration screen shows it. */
export interface MetodoConfigurable {
  metodo: MetodoVerificacion;
  etiqueta: string;
  habilitado: boolean;
}

/** The submitted methods as the set to store: de-duplicated, in catalog order. Callers have already rejected non-optional ones. */
export function ordenarMetodos(metodos: readonly MetodoVerificacion[]): MetodoVerificacion[] {
  const elegidos = new Set(metodos);
  return METODOS_OPCIONALES.filter((metodo) => elegidos.has(metodo));
}

/** Every optional method with its label and whether the farmacia has it on. */
export function describirMetodosConfigurables(habilitados: readonly MetodoVerificacion[]): MetodoConfigurable[] {
  const activos = new Set(habilitados);
  return METODOS_OPCIONALES.map((metodo) => ({ metodo, etiqueta: METODOS[metodo].etiqueta, habilitado: activos.has(metodo) }));
}

/** What changed between two sets, for the audit row and the "no changes" check. */
export function diferenciaMetodos(
  antes: readonly MetodoVerificacion[],
  despues: readonly MetodoVerificacion[],
): { activados: MetodoVerificacion[]; desactivados: MetodoVerificacion[] } {
  const previos = new Set(antes);
  const nuevos = new Set(despues);
  return { activados: despues.filter((metodo) => !previos.has(metodo)), desactivados: antes.filter((metodo) => !nuevos.has(metodo)) };
}
