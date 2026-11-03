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
 *   - Vencimiento: not chosen. The lot follows its active drugs (EL5): it takes the earliest vencimiento vigente of
 *     the consumed partidas of clase DROGA (insumos and excipientes do not bound it), and the database keeps it in
 *     step with them afterwards -- a reanálisis of one moves it, marking one vencida discards it (migration 0114).
 *
 * Every quantity is PHYSICAL and in its droga's unidad base (a stock quantity); the produced cantidad is in the
 * produced droga's unidad base.
 */
import { Decimal, dec } from "@/shared/decimal";
import { formatNumero } from "@/shared/format/cantidad";
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
  /** The consumed droga's clase: only a `DROGA` (an active drug) sets the lot's vencimiento (EL5). */
  drogaClase: string;
}

export interface ElaboracionInput {
  tipo: TipoElaboracion;
  drogaProducidaId: string;
  /** A droga of clase DROGA must expire (trg_partida_validar_vencimiento, migration 0064). */
  drogaProducidaRequiereVencimiento: boolean;
  /** The produced droga's unidad base. */
  cantidadProducida: Decimal | string;
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

/**
 * EL9: the farmacia's sigla that opens every elaborated lot code. A constant while `fsj.parametro` only holds numeric
 * values (modules/parametros/domain/parametros-registry.ts).
 */
export const SIGLA_LOTE_ELABORADO = "FSJ";

const PREFIJO_POR_TIPO: Record<TipoElaboracion, string> = { DILUCION: "DIL", FORMULA: "ELA" };

/** EL9: `FSJ-DIL-` / `FSJ-ELA-` -- the prefix of the lote codes of a tipo's elaborations. */
export function prefijoLoteElaborado(tipo: TipoElaboracion): string {
  return `${SIGLA_LOTE_ELABORADO}-${PREFIJO_POR_TIPO[tipo]}-`;
}

/** EL9: the lote code the system assigns -- the prefix and the tipo's next correlative, 4 digits, never restarted (`yaUsados` + 1). */
export function codigoLoteElaborado(tipo: TipoElaboracion, yaUsados: number): string {
  return `${prefijoLoteElaborado(tipo)}${String(yaUsados + 1).padStart(4, "0")}`;
}

/** The longest name and aspecto the etiqueta takes (migration 0115). */
export const NOMBRE_LOTE_MAX = 120;

/**
 * The name the lot's etiqueta suggests (the user edits it): a dilución reads as its proportion, "Clonazepam 1:100" for
 * 1 %, when 100 / potencia is a whole number (within 0.5 %); otherwise its percentage to 3 significant digits
 * ("45,5 %", "0,455 %": the exact potencia is the partida's, not the name's). A fórmula lot, its droga.
 */
export function nombreSugeridoLote(drogaNombre: string, potenciaDilucion: Decimal | null): string {
  if (potenciaDilucion === null || !potenciaDilucion.greaterThan(0)) return drogaNombre;
  const proporcion = dec(100).dividedBy(potenciaDilucion);
  const entera = proporcion.toDecimalPlaces(0);
  if (entera.greaterThan(1) && proporcion.minus(entera).abs().lessThanOrEqualTo(entera.times("0.005"))) return `${drogaNombre} 1:${entera.toFixed()}`;
  return `${drogaNombre} ${formatNumero(potenciaDilucion.toSignificantDigits(3))} %`;
}

/** A dilución's potencia (percent): the active consumed of its droga over the cantidad producida, rounded down. */
export function potenciaDeDilucion(consumos: readonly ConsumoElaboracion[], drogaId: string, cantidadProducida: Decimal | string): Decimal {
  return activoConsumido(consumos, drogaId).dividedBy(dec(cantidadProducida)).times(CIEN).toDecimalPlaces(DECIMALES_POTENCIA, Decimal.ROUND_DOWN);
}

/**
 * Milligrams per unit of each mass unit, by símbolo. The "Elaborar lote" form shows and takes every mass in mg (as the
 * ficha técnica shows it); the command still gets each droga's unidad base.
 */
const MG_POR_SIMBOLO: Readonly<Record<string, string>> = { mcg: "0.001", mg: "1", g: "1000", kg: "1000000" };

/** The unit the form uses for a droga of unidad base `simbolo`: mg for a mass, its own unit otherwise (mL). */
export function simboloEnFormulario(simbolo: string): string {
  return MG_POR_SIMBOLO[simbolo] === undefined ? simbolo : "mg";
}

/** A quantity in the droga's unidad base, in the form's unit. */
export function aUnidadDeFormulario(valorBase: Decimal | string, simbolo: string): Decimal {
  const mg = MG_POR_SIMBOLO[simbolo];
  return mg === undefined ? dec(valorBase) : dec(valorBase).times(mg);
}

/** A quantity typed in the form's unit, in the droga's unidad base (what the command records). */
export function aUnidadBase(valorFormulario: Decimal | string, simbolo: string): Decimal {
  const mg = MG_POR_SIMBOLO[simbolo];
  return mg === undefined ? dec(valorFormulario) : dec(valorFormulario).dividedBy(mg);
}

/** EL4: what the consumed partidas cost, per unit of the cantidad producida. */
export function costoUnitarioDeLote(consumos: readonly ConsumoElaboracion[], cantidadProducida: Decimal | string): Decimal {
  const total = consumos.reduce((suma, c) => suma.plus(dec(c.cantidad).times(dec(c.costoUnitario))), dec(0));
  return total.dividedBy(dec(cantidadProducida));
}

/** EL5: the lot's vencimiento -- the earliest vencimiento vigente among the consumed active drugs (clase DROGA); `null` when none. */
export function vencimientoDelLote(consumos: readonly ConsumoElaboracion[]): string | null {
  return consumos.reduce<string | null>((minimo, c) => {
    if (c.drogaClase !== "DROGA" || c.fechaVencimiento === null) return minimo;
    return minimo === null || c.fechaVencimiento < minimo ? c.fechaVencimiento : minimo;
  }, null);
}

/**
 * Validates an elaboración and computes the produced partida (EL1-EL5). Throws `DomainError` with the offending
 * field(s): `cantidadProducida`, `componentes`, `cantidad_<partidaId>`.
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

  // No consumed lot is expired (checked above), so the lot's vencimiento is never past.
  const fechaVencimiento = vencimientoDelLote(input.consumos);
  if (fechaVencimiento === null && input.drogaProducidaRequiereVencimiento) {
    throw new DomainError("El lote toma el vencimiento de la droga activa que consume: indicá al menos un lote de una droga.", { fields: ["componentes"] });
  }

  return { potenciaDeclarada, costoUnitario: costoUnitarioDeLote(input.consumos, cantidadProducida), fechaVencimiento };
}
