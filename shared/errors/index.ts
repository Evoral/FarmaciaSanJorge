/**
 * Application error hierarchy + safe error mapping.
 *
 * Convention (see docs/architecture.md): domain/DB invariants raised in
 * Postgres always look like `INV-XXX: human message` with SQLSTATE P0001
 * (see the migration.sql files under prisma/migrations/). `mapDbError`
 * recognizes that shape and turns it into an `InvariantViolationError`; everything else
 * becomes a generic, safe error. Nothing here ever leaks SQL text, stack
 * traces, or raw driver error objects to a caller outside the server.
 *
 * Every message a class or `mapDbError` produces by default is Spanish,
 * because it may reach the UI. What the user finally sees is decided by
 * `userMessageFor` (INV codes translated via ./mensajes-invariantes.ts);
 * the raw text is logged by `logErrorForDiagnostics`.
 */
import { getLogger } from "@/shared/logging/logger";
import { MENSAJE_INVARIANTE_GENERICO, mensajeParaInvariante } from "./mensajes-invariantes";

export { MENSAJES_INVARIANTES, MENSAJE_INVARIANTE_GENERICO, mensajeParaInvariante, mensajeGlobalParaInvariante } from "./mensajes-invariantes";

export type AppErrorCode =
  | "DOMAIN_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "CONFLICT"
  | "INVARIANT_VIOLATION"
  | "STEP_UP_REQUIRED"
  | "INTERNAL_ERROR";

export interface AppErrorOptions {
  cause?: unknown;
  /**
   * Names of the form fields (top-level input keys, i.e. the `name` of the
   * submitted control) the error is about, so the UI can mark exactly those
   * fields -- see `shared/ui/action-error.ts` and `shared/ui/field-errors.ts`.
   * Omitted when the error is about the input as a whole. Of the
   * subclasses, only `ValidationError` and `DomainError` accept it.
   */
  fields?: readonly string[];
}

/** Base class for all errors the application raises deliberately. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly fields?: readonly string[];

  constructor(code: AppErrorCode, message: string, options?: AppErrorOptions) {
    super(message, options && "cause" in options ? { cause: options.cause } : undefined);
    this.code = code;
    this.name = new.target.name;
    if (options?.fields && options.fields.length > 0) {
      this.fields = options.fields;
    }
  }
}

/** A business rule was violated (application-level check, not a DB invariant). */
export class DomainError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("DOMAIN_ERROR", message, options);
  }
}

/**
 * There is no valid, active session (missing/expired/revoked cookie, or the
 * underlying usuario/tenant is no longer eligible to hold one -- FASE 2,
 * `requireSession()`). Distinct from `AuthorizationError`: this means "we
 * don't know who you are" (401-shaped), not "we know who you are and you
 * can't do this" (403-shaped).
 */
export class AuthenticationError extends AppError {
  constructor(message = "Tu sesión no es válida o expiró. Iniciá sesión nuevamente.", options?: { cause?: unknown }) {
    super("AUTHENTICATION_ERROR", message, options);
  }
}

/** The current session is not allowed to perform the requested action. */
export class AuthorizationError extends AppError {
  constructor(message = "No tenés permiso para realizar esta acción.", options?: { cause?: unknown }) {
    super("AUTHORIZATION_ERROR", message, options);
  }
}

/**
 * The session is authenticated and authorized, but the action requires a
 * RECENT re-authentication (INV-X02, FASE 2 point 2.5 -- step-up) that
 * this session does not have. Deliberately distinct from
 * `AuthenticationError` (no session at all) and `AuthorizationError` (this
 * session can never do this) -- the UI needs to tell "please re-enter your
 * password" apart from "please log in" or "you can't do this", and only a
 * distinguishable error type makes that reliable across a Server Action
 * boundary.
 */
export class StepUpRequiredError extends AppError {
  constructor(message = "Esta acción requiere que vuelvas a confirmar tu identidad.", options?: { cause?: unknown }) {
    super("STEP_UP_REQUIRED", message, options);
  }
}

/** The requested entity does not exist (or is invisible to this tenant). */
export class NotFoundError extends AppError {
  constructor(message = "No se encontró el registro solicitado.", options?: { cause?: unknown }) {
    super("NOT_FOUND", message, options);
  }
}

/** Input failed validation (normally a zod parse failure at the server edge). */
export class ValidationError extends AppError {
  constructor(message: string, options?: AppErrorOptions) {
    super("VALIDATION_ERROR", message, options);
  }
}

/** The operation conflicts with existing state (unique/FK violation, stale state, etc). */
export class ConflictError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super("CONFLICT", message, options);
  }
}

/**
 * A database-enforced invariant (trigger, constraint) was violated.
 * `invariantCode` is the `INV-XXX` token extracted from the Postgres error.
 */
export class InvariantViolationError extends AppError {
  readonly invariantCode: string;

  constructor(invariantCode: string, message: string, options?: { cause?: unknown }) {
    super("INVARIANT_VIOLATION", message, options);
    this.invariantCode = invariantCode;
  }
}

/** Shape of the subset of Prisma known-request errors we care about. */
interface PrismaLikeKnownError {
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

function isPrismaLikeKnownError(e: unknown): e is PrismaLikeKnownError {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    typeof (e as { code: unknown }).code === "string" &&
    "message" in e
  );
}

const INV_CODE_PATTERN = /INV-([A-Z0-9]+(?:-[A-Z0-9]+)*)/;

/** Extracts `INV-XXX` from a raw Postgres/Prisma error message, if present. */
function extractInvariantCode(message: string): string | null {
  const match = INV_CODE_PATTERN.exec(message);
  return match ? `INV-${match[1]}` : null;
}

/**
 * Maps a thrown error (typically a Prisma error, or a raw `pg` driver
 * error) to a domain-level `AppError`. Unknown errors are wrapped as a
 * generic `AppError` with code `INTERNAL_ERROR` -- never re-thrown raw.
 */
export function mapDbError(e: unknown): AppError {
  if (e instanceof AppError) return e;

  if (isPrismaLikeKnownError(e)) {
    // Postgres RAISE EXCEPTION ... USING ERRCODE = 'P0001' surfaces in
    // Prisma as code P2010 (raw query failed) or similar, wrapping the
    // original message. We look for the INV-XXX token regardless of the
    // wrapping Prisma error code.
    const invCode = extractInvariantCode(e.message);
    if (invCode) {
      return new InvariantViolationError(invCode, e.message, { cause: e });
    }

    // Prisma known error codes: https://pris.ly/d/error-reference
    if (e.code === "P2002") {
      return new ConflictError("Ya existe un registro con esos mismos datos.", { cause: e });
    }
    if (e.code === "P2003") {
      return new ConflictError("La operación hace referencia a un registro que no existe o no está disponible.", {
        cause: e,
      });
    }
    if (e.code === "P2025") {
      return new NotFoundError(undefined, { cause: e });
    }

    // Postgres EXCLUDE constraint violation, SQLSTATE 23P01 (FASE 3.9,
    // INV-DT-002: designacion_dt_titular_no_solapa -- migration 0005,
    // currently the ONLY EXCLUDE constraint in this schema). Prisma 7's
    // client engine (pg driver adapter) has no native P2xxx code for this
    // constraint type: it wraps it as the generic `P2039` ("Database
    // error") code, with the ORIGINAL SQLSTATE surfacing in two places --
    // `e.meta.driverAdapterError.cause.code` (structured, checked first)
    // and embedded as literal text in `e.message` ("Code: `23P01`.",
    // checked as a fallback in case a future Prisma version reshapes
    // `meta` but keeps the message text). Verified empirically against
    // Prisma 7.10.0 + @prisma/adapter-pg by inserting two overlapping
    // TITULAR designations and inspecting the thrown error's real shape
    // (see modules/directores-tecnicos/application/designar-director-tecnico.ts's
    // doc comment). If a second EXCLUDE constraint is ever added elsewhere,
    // revisit this to also check the constraint name (available at the
    // same nested meta path) instead of mapping every 23P01 to this one
    // Spanish message.
    if (
      e.code === "P2039" &&
      (e.message.includes("23P01") ||
        (e.meta as { driverAdapterError?: { cause?: { code?: string } } } | undefined)?.driverAdapterError?.cause?.code === "23P01")
    ) {
      return new ConflictError("Ya existe una designación TITULAR vigente que se superpone con ese período.", { cause: e });
    }

    // Postgres deadlock_detected (40P01) / serialization_failure (40001) --
    // raw SQLSTATE codes, surfaced either directly (the `pg` driver adapter
    // behind $queryRaw/$executeRaw does not always wrap them in a Prisma
    // Pxxxx code) or as Prisma's own P2034 ("Transaction failed due to a
    // write conflict or a deadlock. Please retry your transaction").
    // FASE 3 M3 (usuarios): the ordered `FOR UPDATE` lock in
    // `lockUsuarioYAdministradoresActivos` (admin-guard.ts) makes an actual
    // deadlock between two of these commands very unlikely, but not
    // impossible under adversarial timing/retries -- map it to a
    // `ConflictError` with a Spanish, retry-shaped message instead of the
    // generic INTERNAL_ERROR, so the UI can show something actionable.
    if (e.code === "40P01" || e.code === "40001" || e.code === "P2034") {
      return new ConflictError("La operación no se pudo completar por una actualización concurrente. Volvé a intentarlo.", {
        cause: e,
      });
    }

    return new AppError("INTERNAL_ERROR", "Ocurrió un error en la base de datos.", { cause: e });
  }

  if (e instanceof Error) {
    const invCode = extractInvariantCode(e.message);
    if (invCode) {
      return new InvariantViolationError(invCode, e.message, { cause: e });
    }
    return new AppError("INTERNAL_ERROR", "Ocurrió un error inesperado.", { cause: e });
  }

  return new AppError("INTERNAL_ERROR", "Ocurrió un error inesperado.", { cause: e });
}

/**
 * The Spanish message an end user may see for `error` -- the single place
 * that decides it, used by `actionError` (Server Actions) and `toSafeError`
 * (route handlers). Never returns a raw DB/driver text or an `INV-XXX`
 * code:
 *
 * - `InvariantViolationError`: the global translation table
 *   (`./mensajes-invariantes.ts`). Module tables have already turned the
 *   codes they know into a `DomainError` inside their own use case, so they
 *   take precedence without any extra wiring here.
 * - `AuthenticationError` / `AuthorizationError`: fixed messages (the raw
 *   ones may carry internal detail, e.g. the missing permiso code).
 * - `INTERNAL_ERROR` and anything that is not an `AppError`: `fallback`
 *   (the caller's own "No se pudo ..." for that operation).
 * - Every other `AppError` (DomainError, ValidationError, ConflictError,
 *   NotFoundError, StepUpRequiredError): authored for the user, shown as
 *   is -- unless it still embeds an `INV-XXX` token, in which case that
 *   code is translated instead (defense in depth).
 */
export function userMessageFor(error: unknown, fallback: string): string {
  if (!(error instanceof AppError)) return fallback;
  if (error instanceof InvariantViolationError) return mensajeParaInvariante(error.invariantCode);

  switch (error.code) {
    case "AUTHENTICATION_ERROR":
      return MENSAJES_SEGUROS.AUTHENTICATION_ERROR;
    case "AUTHORIZATION_ERROR":
      return MENSAJES_SEGUROS.AUTHORIZATION_ERROR;
    case "INTERNAL_ERROR":
      return fallback;
    case "INVARIANT_VIOLATION":
      // A bare `AppError("INVARIANT_VIOLATION", ...)` without the subclass.
      return mensajeParaInvariante(extractInvariantCode(error.message) ?? "");
    default: {
      const embedded = extractInvariantCode(error.message);
      return embedded ? mensajeParaInvariante(embedded) : error.message;
    }
  }
}

/**
 * Logs `error` server-side with its RAW message, code, `invariantCode` and
 * `cause` chain (pino's `err` serializer), so replacing what the user sees
 * with a translated message never loses diagnostics. Only errors worth a
 * look are logged: unexpected ones (`INTERNAL_ERROR`, non-`AppError`) at
 * `error`; invariant violations, authorization denials and any `AppError`
 * wrapping a lower-level `cause` (e.g. a module's `DomainError` built from
 * an `InvariantViolationError`, a `ConflictError` from a DB constraint) at
 * `warn`. Plain user errors (validation, not found, ...) are not logged.
 * Best-effort: a logging failure never changes the caller's outcome.
 */
export function logErrorForDiagnostics(error: unknown, context?: Record<string, unknown>): void {
  const level = diagnosticLevel(error);
  if (!level) return;
  try {
    const details =
      error instanceof AppError
        ? { code: error.code, ...(error instanceof InvariantViolationError ? { invariantCode: error.invariantCode } : {}) }
        : {};
    getLogger()[level]({ err: error, ...details, ...context }, "Error replaced by a user-facing message");
  } catch {
    // Logger unavailable (e.g. env not configured in a unit test): never mask the original error.
  }
}

function diagnosticLevel(error: unknown): "error" | "warn" | null {
  if (!(error instanceof AppError) || error.code === "INTERNAL_ERROR") return "error";
  if (error instanceof InvariantViolationError || error.code === "AUTHORIZATION_ERROR") return "warn";
  if (error.cause !== undefined) return "warn";
  return null;
}

/** What a caller outside the server process is allowed to see. */
export interface SafeError {
  code: AppErrorCode | string;
  message: string;
  requestId: string;
}

const MENSAJES_SEGUROS: Record<AppErrorCode, string> = {
  DOMAIN_ERROR: "No se pudo completar la operación.",
  AUTHENTICATION_ERROR: "Tu sesión no es válida o expiró. Iniciá sesión nuevamente.",
  AUTHORIZATION_ERROR: "No tenés permiso para realizar esta acción.",
  NOT_FOUND: "No se encontró el registro solicitado.",
  VALIDATION_ERROR: "Los datos ingresados no son válidos.",
  CONFLICT: "La operación entra en conflicto con el estado actual de los datos. Actualizá la página y volvé a intentarlo.",
  INVARIANT_VIOLATION: MENSAJE_INVARIANTE_GENERICO,
  STEP_UP_REQUIRED: "Esta acción requiere que vuelvas a confirmar tu identidad.",
  INTERNAL_ERROR: "Ocurrió un error inesperado. Volvé a intentarlo.",
};

/**
 * Converts any error into a `SafeError` fit for a client response (route
 * handlers): a Spanish message (never the raw exception message, which may
 * embed SQL or internal identifiers), the error CATEGORY as `code` (never
 * an `INV-XXX` token), plus a request id for support correlation with the
 * server log line this function writes (`logErrorForDiagnostics`, which
 * keeps the raw message and the `invariantCode`).
 */
export function toSafeError(e: unknown, requestId: string): SafeError {
  const appError = e instanceof AppError ? e : mapDbError(e);
  logErrorForDiagnostics(appError, { requestId });

  if (appError instanceof InvariantViolationError) {
    return { code: appError.code, message: mensajeParaInvariante(appError.invariantCode), requestId };
  }

  // DomainError and ValidationError messages are authored by us (not by
  // the DB driver) specifically to be shown to the end user, so they pass
  // through (via userMessageFor, which still strips an embedded INV code).
  // Everything else uses the fixed generic message for its code.
  if (appError instanceof DomainError || appError instanceof ValidationError) {
    return { code: appError.code, message: userMessageFor(appError, MENSAJES_SEGUROS[appError.code]), requestId };
  }

  return {
    code: appError.code,
    message: MENSAJES_SEGUROS[appError.code],
    requestId,
  };
}
