/**
 * D5 (2026-09-23) / jd-fix-agent FIX 3: canonical form of
 * `asiento_historico.numero_asiento_fisico`. The column is `text`, so
 * "7", "07", and " 7" are three DIFFERENT strings that would otherwise
 * defeat migration 0035's `UNIQUE (tenant_id, tipo_libro,
 * numero_asiento_fisico)` -- the same physical folio could be digitized
 * more than once just by varying whitespace/leading zeros.
 *
 * Canonical form:
 *   - trimmed (leading/trailing whitespace removed);
 *   - if the trimmed value is PURELY digits, leading zeros are stripped
 *     (`"07"` -> `"7"`, `"000"` -> `"0"` -- never an empty string, since at
 *     least one digit survives);
 *   - any other value (e.g. `"12-bis"`) is kept as the trimmed text,
 *     verbatim -- this function never rejects/reshapes a non-numeric
 *     physical folio beyond trimming it.
 *
 * Mirrored in SQL by the CHECK constraint added in migration 0035 -- keep
 * the two in sync (see that migration's header comment).
 */
export function canonicalizarNumeroAsientoFisico(raw: string): string {
  const trimmed = raw.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    const sinCerosIniciales = trimmed.replace(/^0+/, "");
    return sinCerosIniciales === "" ? "0" : sinCerosIniciales;
  }
  return trimmed;
}
