/**
 * Elaborating a lot in the farmacia (openspec/changes/lotes-elaborados, spec elaboracion-lote EL1-EL5). Pure: no I/O,
 * no Prisma. The command (`stock.lote.elaborar`) validates and computes the produced partida with it; the database
 * re-checks the whole elaboration at commit (migration 0111, INV-EL1..EL4).
 *
 *   - DILUCION: the product is a partida of the SAME droga as its principal component. Its potencia is the active
 *     consumed of that droga over the cantidad producida, rounded DOWN to `DECIMALES_POTENCIA` (declaring more potency
 *     than there is would under-dose). The active it then holds stays within INV-EL3's 10^-4 of the active consumed.
 *   - FORMULA: the product is another droga; it never consumes itself.
 *   - Costo: what the consumed partidas cost (their `costo_unitario`) over the cantidad producida (EL4). A missing costo
 *     de proveedor never blocks elaborating.
 *   - Vencimiento: never later than the earliest vencimiento vigente consumed (EL5); defaults to it.
 *
 * Every quantity is PHYSICAL and in its droga's unidad base (a stock quantity); the produced cantidad is in the
 * produced droga's unidad base.
 */
import { Decimal, dec } from "@/shared/decimal";
import { DomainError } from "@/shared/errors";
import { estaVencida } from "./reparto";

/** Decimals a dilución's potencia is rounded (down) to. INV-EL3's 10^-4 tolerance holds up to 10 000 units produced. */
export const DECIMALES_POTENCIA = 6;

const CIEN = dec(100);

export type TipoElaboracion = "DILUCION" | "FORMULA";

/** EL6: with the contralor active, an elaboración with a controlled droga is refused (its asientos are not defined yet). */
export const MENSAJE_CONTRALOR_ELABORACION =
  "El contralor está activo y esta elaboración incluye una droga controlada: los asientos del contralor para elaborar lotes todavía no están definidos.";

/** One partida consumed by the elaboración. */
export interface ConsumoElaboracion {
  partidaId: string;
  lote: string;
  drogaId: string;
  drogaNombre: string;
  /** PHYSICAL quantity taken, the droga's unidad base. */
  cantidad: Decimal | string;
  /** What can be taken: `cantidad_disponible` minus what INICIADA preparaciones reserve. */
  cantidadDisponible: Decimal | string;
  /** `partida.costo_unitario`, per the droga's unidad base. */
  costoUnitario: Decimal | string;
  /** `partida.potencia_declarada` (percent), `null` = 100. */
  potenciaDeclarada: Decimal | string | null;
  /** The vencimiento VIGENTE, `YYYY-MM-DD`; `null` = does not expire. */
  fechaVencimiento: string | null;
}

export interface ElaboracionInput {
  tipo: TipoElaboracion;
  drogaProducidaId: string;
  /** A droga of clase DROGA must expire (trg_partida_validar_vencimiento, migration 0064). */
  drogaProducidaRequiereVencimiento: boolean;
  /** The produced droga's unidad base. */
  cantidadProducida: Decimal | string;
  /** Requested vencimiento, `YYYY-MM-DD`; `null` = the default (`vencimientoMaximo`). */
  fechaVencimiento: string | null;
  consumos: readonly ConsumoElaboracion[];
  /** `fsj.jornada_actual`, `YYYY-MM-DD`. */
  jornada: string;
}

export interface LoteElaborado {
  /** The produced partida's `potencia_declarada`: computed for a DILUCION, `null` for a FORMULA lot. */
  potenciaDeclarada: Decimal | null;
  /** The produced partida's `costo_unitario`, per the produced droga's unidad base. */
  costoUnitario: Decimal;
  /** The produced partida's `fecha_vencimiento`. */
  fechaVencimiento: string | null;
}

function potenciaOCien(potencia: Decimal | string | null): Decimal {
  return potencia === null ? CIEN : dec(potencia);
}

/** Active ingredient of `drogaId` the consumos carry (each physical quantity x its partida's potencia / 100). */
export function activoConsumido(consumos: readonly ConsumoElaboracion[], drogaId: string): Decimal {
  return consumos
    .filter((c) => c.drogaId === drogaId)
    .reduce((total, c) => total.plus(dec(c.cantidad).times(potenciaOCien(c.potenciaDeclarada)).dividedBy(CIEN)), dec(0));
}

const PREFIJO_POR_TIPO: Record<TipoElaboracion, string> = { DILUCION: "DIL", FORMULA: "ELA" };

/** EL9: `DIL-20261029-` / `ELA-20261029-` -- the prefix of the lote codes of the jornada's elaborations of a tipo. */
export function prefijoLoteElaborado(tipo: TipoElaboracion, jornada: string): string {
  return `${PREFIJO_POR_TIPO[tipo]}-${jornada.replaceAll("-", "")}-`;
}

/** EL9: the lote code the system assigns -- the prefix and the next number of the tipo in the jornada (`yaUsados` + 1). */
export function codigoLoteElaborado(tipo: TipoElaboracion, jornada: string, yaUsados: number): string {
  return `${prefijoLoteElaborado(tipo, jornada)}${yaUsados + 1}`;
}

/** A dilución's potencia (percent): the active consumed of its droga over the cantidad producida, rounded down. */
export function potenciaDeDilucion(consumos: readonly ConsumoElaboracion[], drogaId: string, cantidadProducida: Decimal | string): Decimal {
  return activoConsumido(consumos, drogaId).dividedBy(dec(cantidadProducida)).times(CIEN).toDecimalPlaces(DECIMALES_POTENCIA, Decimal.ROUND_DOWN);
}

/** EL4: what the consumed partidas cost, per unit of the cantidad producida. */
export function costoUnitarioDeLote(consumos: readonly ConsumoElaboracion[], cantidadProducida: Decimal | string): Decimal {
  const total = consumos.reduce((suma, c) => suma.plus(dec(c.cantidad).times(dec(c.costoUnitario))), dec(0));
  return total.dividedBy(dec(cantidadProducida));
}

/** EL5: the earliest vencimiento vigente among the consumed partidas; `null` when none expires. */
export function vencimientoMaximo(consumos: readonly ConsumoElaboracion[]): string | null {
  return consumos.reduce<string | null>((minimo, c) => {
    if (c.fechaVencimiento === null) return minimo;
    return minimo === null || c.fechaVencimiento < minimo ? c.fechaVencimiento : minimo;
  }, null);
}

/**
 * Validates an elaboración and computes the produced partida (EL1-EL5). Throws `DomainError` with the offending
 * field(s): `cantidadProducida`, `componentes`, `cantidad_<partidaId>`, `fechaVencimiento`.
 */
export function validarElaboracion(input: ElaboracionInput): LoteElaborado {
  const cantidadProducida = dec(input.cantidadProducida);
  if (!cantidadProducida.isFinite() || !cantidadProducida.greaterThan(0)) {
    throw new DomainError("La cantidad producida debe ser mayor que 0.", { fields: ["cantidadProducida"] });
  }
  if (input.consumos.length === 0) {
    throw new DomainError("Indicá al menos un lote a consumir.", { fields: ["componentes"] });
  }

  const vistas = new Set<string>();
  for (const c of input.consumos) {
    const campo = `cantidad_${c.partidaId}`;
    if (vistas.has(c.partidaId)) {
      throw new DomainError(`El lote ${c.lote} (${c.drogaNombre}) está repetido.`, { fields: [campo] });
    }
    vistas.add(c.partidaId);
    const cantidad = dec(c.cantidad);
    if (!cantidad.isFinite() || !cantidad.greaterThan(0)) {
      throw new DomainError(`La cantidad del lote ${c.lote} (${c.drogaNombre}) debe ser mayor que 0.`, { fields: [campo] });
    }
    if (estaVencida(c.fechaVencimiento, input.jornada)) {
      throw new DomainError(`El lote ${c.lote} (${c.drogaNombre}) está vencido: no se puede consumir.`, { fields: [campo] });
    }
    if (cantidad.greaterThan(dec(c.cantidadDisponible))) {
      throw new DomainError(`Stock insuficiente en el lote ${c.lote} (${c.drogaNombre}): hay ${dec(c.cantidadDisponible).toFixed()} disponibles.`, {
        fields: [campo],
      });
    }
  }

  const consumeSuDroga = input.consumos.some((c) => c.drogaId === input.drogaProducidaId);
  let potenciaDeclarada: Decimal | null = null;
  if (input.tipo === "DILUCION") {
    if (!consumeSuDroga) {
      throw new DomainError("Una dilución tiene que consumir un lote de la droga que se diluye.", { fields: ["componentes"] });
    }
    potenciaDeclarada = potenciaDeDilucion(input.consumos, input.drogaProducidaId, cantidadProducida);
    if (!potenciaDeclarada.greaterThan(0)) {
      throw new DomainError("La dilución queda con una potencia demasiado baja para registrarla: revisá las cantidades.", { fields: ["cantidadProducida"] });
    }
    if (potenciaDeclarada.greaterThan(CIEN)) {
      throw new DomainError("La cantidad producida es menor que el principio activo consumido: revisá las cantidades.", { fields: ["cantidadProducida"] });
    }
  } else if (consumeSuDroga) {
    throw new DomainError("Un lote elaborado no puede consumir la misma droga que produce.", { fields: ["componentes"] });
  }

  const maximo = vencimientoMaximo(input.consumos);
  const fechaVencimiento = input.fechaVencimiento ?? maximo;
  if (maximo !== null && fechaVencimiento !== null && fechaVencimiento > maximo) {
    throw new DomainError(`El lote no puede vencer después que sus componentes (el primero vence el ${maximo}).`, { fields: ["fechaVencimiento"] });
  }
  if (fechaVencimiento === null && input.drogaProducidaRequiereVencimiento) {
    throw new DomainError("Indicá la fecha de vencimiento del lote.", { fields: ["fechaVencimiento"] });
  }
  if (fechaVencimiento !== null && fechaVencimiento < input.jornada) {
    throw new DomainError("La fecha de vencimiento ya pasó.", { fields: ["fechaVencimiento"] });
  }

  return { potenciaDeclarada, costoUnitario: costoUnitarioDeLote(input.consumos, cantidadProducida), fechaVencimiento };
}
