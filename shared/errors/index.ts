/**
 * Application error hierarchy + safe error mapping.
 *
 * Convention (see docs/architecture.md): domain/DB invariants raised in
 * Postgres always look like `INV-XXX: human message` with SQLSTATE P0001
 * (see the migration.sql files under prisma/migrations/). `mapDbError`
 * recognizes that shape and turns it into an `InvariantViolationError`; everything else
 * becomes a generic, safe error. Nothing here ever leaks SQL text, stack
 * traces, or raw driver error objects to a caller outside the server.
 */

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

/** Base class for all errors the application raises deliberately. */
export class AppError extends Error {
  readonly code: AppErrorCode;

  constructor(code: AppErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = new.target.name;
  }
}

/** A business rule was violated (application-level check, not a DB invariant). */
export class DomainError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
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
  constructor(message = "Authentication is required to perform this action.", options?: { cause?: unknown }) {
    super("AUTHENTICATION_ERROR", message, options);
  }
}

/** The current session is not allowed to perform the requested action. */
export class AuthorizationError extends AppError {
  constructor(message = "You are not authorized to perform this action.", options?: { cause?: unknown }) {
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
  constructor(message = "This action requires a recent re-authentication.", options?: { cause?: unknown }) {
    super("STEP_UP_REQUIRED", message, options);
  }
}

/** The requested entity does not exist (or is invisible to this tenant). */
export class NotFoundError extends AppError {
  constructor(message = "The requested resource was not found.", options?: { cause?: unknown }) {
    super("NOT_FOUND", message, options);
  }
}

/** Input failed validation (normally a zod parse failure at the server edge). */
export class ValidationError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
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
      return new ConflictError("A record with the same unique value already exists.", { cause: e });
    }
    if (e.code === "P2003") {
      return new ConflictError("The operation references a record that does not exist or is not visible.", {
        cause: e,
      });
    }
    if (e.code === "P2025") {
      return new NotFoundError("The requested resource was not found.", { cause: e });
    }

    return new AppError("INTERNAL_ERROR", "A database error occurred.", { cause: e });
  }

  if (e instanceof Error) {
    const invCode = extractInvariantCode(e.message);
    if (invCode) {
      return new InvariantViolationError(invCode, e.message, { cause: e });
    }
    return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", { cause: e });
  }

  return new AppError("INTERNAL_ERROR", "An unexpected error occurred.", { cause: e });
}

/** What a caller outside the server process is allowed to see. */
export interface SafeError {
  code: AppErrorCode | string;
  message: string;
  requestId: string;
}

const SAFE_MESSAGES: Record<AppErrorCode, string> = {
  DOMAIN_ERROR: "The operation could not be completed.",
  AUTHENTICATION_ERROR: "Authentication is required to perform this action.",
  AUTHORIZATION_ERROR: "You are not authorized to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  VALIDATION_ERROR: "The provided input is invalid.",
  CONFLICT: "The operation conflicts with the current state.",
  INVARIANT_VIOLATION: "The operation violates a system rule.",
  STEP_UP_REQUIRED: "This action requires a recent re-authentication.",
  INTERNAL_ERROR: "An unexpected error occurred. Please try again.",
};

/**
 * Converts any error into a `SafeError` fit for a client response: fixed,
 * generic messages per category (never the raw exception message, which
 * may embed SQL or internal identifiers), plus a request id for support
 * correlation with server logs.
 */
export function toSafeError(e: unknown, requestId: string): SafeError {
  const appError = e instanceof AppError ? e : mapDbError(e);

  if (appError instanceof InvariantViolationError) {
    return {
      code: appError.invariantCode,
      message: SAFE_MESSAGES.INVARIANT_VIOLATION,
      requestId,
    };
  }

  // DomainError and ValidationError messages are authored by us (not by
  // the DB driver) specifically to be shown to the end user, so they pass
  // through. Everything else uses the fixed generic message for its code.
  if (appError instanceof DomainError || appError instanceof ValidationError) {
    return { code: appError.code, message: appError.message, requestId };
  }

  return {
    code: appError.code,
    message: SAFE_MESSAGES[appError.code],
    requestId,
  };
}
