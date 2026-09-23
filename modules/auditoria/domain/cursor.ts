/**
 * Cursor encode/decode for keyset ("seek") pagination over
 * `fsj.registro_auditoria` (M01/M03, FASE 3 point 3.11). Pure, DB-free --
 * unit-tested directly in tests/unit/auditoria-cursor.test.ts.
 *
 * WHY THE CURSOR MUST ENCODE BOTH `ocurridoEn` AND `id`: the table has no
 * purge and grows forever, so `OFFSET n` pagination is explicitly ruled
 * out for this screen (it degrades linearly with table size). Keyset
 * pagination replaces "skip N rows" with "give me rows strictly after the
 * last one I saw", which requires the sort key to be a total order -- and
 * `ocurrido_en` ALONE is not one: `audit.record()` writes happen inside
 * fast application transactions, so two different rows CAN share the exact
 * same `ocurrido_en` timestamp (same millisecond). If the cursor only
 * carried `ocurridoEn`, a page boundary falling in the middle of a group of
 * same-timestamp rows would either replay or silently drop the rest of
 * that group on the next page (see
 * tests/db/auditoria-listado-cursor.test.ts for the concrete
 * repro/assertion). Encoding the composite `(ocurridoEn, id)` -- matching
 * the repository's `ORDER BY ocurrido_en DESC, id DESC` -- makes the sort
 * key unique per row, so the keyset predicate never skips or repeats one.
 *
 * The cursor is an opaque, ROUND-TRIPPABLE token, not a security boundary:
 * it is base64url of a small JSON object, deliberately simple rather than
 * cryptographically signed. A client that tampers with it can only ever
 * narrow or replay its OWN tenant-scoped, permission-gated query (RLS +
 * `authorize("auditoria.ver")` still apply on every request) -- the worst
 * a malformed or hand-crafted cursor can do is make the query return an
 * unexpected (but still tenant-scoped) slice, which is why a malformed one
 * is rejected outright rather than guessed at.
 */
import { ValidationError } from "@/shared/errors";

export interface AuditoriaCursor {
  ocurridoEn: Date;
  id: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Encodes `(ocurridoEn, id)` into an opaque cursor string. */
export function encodeCursor(cursor: AuditoriaCursor): string {
  const payload = JSON.stringify({ ocurridoEn: cursor.ocurridoEn.toISOString(), id: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Decodes a cursor string produced by `encodeCursor`. Defensive by design
 * -- the value round-trips through a URL query string / client request, so
 * it must be treated as untrusted input: throws `ValidationError` (not a
 * silent `null`) on anything malformed, matching how every other use-case
 * input in this codebase fails at the edge (`shared/usecase.ts`'s
 * `parseInput`).
 */
export function decodeCursor(raw: string): AuditoriaCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Invalid pagination cursor.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new ValidationError("Invalid pagination cursor.");
  }

  const { ocurridoEn, id } = parsed as Record<string, unknown>;
  if (typeof ocurridoEn !== "string" || typeof id !== "string") {
    throw new ValidationError("Invalid pagination cursor.");
  }

  const date = new Date(ocurridoEn);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("Invalid pagination cursor.");
  }
  if (!UUID_PATTERN.test(id)) {
    throw new ValidationError("Invalid pagination cursor.");
  }

  return { ocurridoEn: date, id };
}
