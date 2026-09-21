import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Architecture boundary rules (plan §8 / docs/architecture.md).
//
// `modules/*/domain/**` must stay pure: no I/O, no Prisma, no Next, no
// reaching into another module's (or its own module's) infrastructure
// layer. `app/**` must talk to a module only through its `application/`
// use cases, never straight into `infrastructure/`.
//
// Both relative and `@/`-aliased forms of an import are covered, since
// nothing stops a file from using either.
const domainBoundaryPatterns = [
  {
    group: ["@prisma/client", "@/generated/prisma", "@/generated/prisma/*", "**/generated/prisma/**"],
    message: "modules/*/domain must not import the Prisma client. Domain code is pure (no I/O). Put DB access in the module's infrastructure/ layer.",
  },
  {
    group: ["@/shared/db", "@/shared/db/*", "**/shared/db/**"],
    message: "modules/*/domain must not import shared/db. Domain code is pure (no I/O). Put DB access in the module's infrastructure/ layer.",
  },
  {
    group: ["next", "next/*"],
    message: "modules/*/domain must not import Next.js. Domain code is framework-agnostic.",
  },
  {
    group: ["@/modules/*/infrastructure", "@/modules/*/infrastructure/*", "**/modules/*/infrastructure/**"],
    message: "modules/*/domain must not import any module's infrastructure/ layer (including its own). Domain code has no I/O.",
  },
];

const appBoundaryPatterns = [
  {
    group: ["@/modules/*/infrastructure", "@/modules/*/infrastructure/*", "**/modules/*/infrastructure/**"],
    message: "app/** must not import a module's infrastructure/ layer directly. Go through the module's application/ use cases instead.",
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["modules/*/domain/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: domainBoundaryPatterns }],
    },
  },
  {
    files: ["app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", { patterns: appBoundaryPatterns }],
    },
  },
  // The use-case pipeline (requireSession -> authorize -> zod -> tx -> audit)
  // is only a guarantee if nothing else opens a tenant transaction. Business
  // code must go through shared/usecase.ts; modules/auth is exempt because
  // login and session validation legitimately run BEFORE a session exists.
  {
    files: ["app/**/*.{ts,tsx}", "modules/**/*.ts"],
    ignores: ["modules/auth/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            ...appBoundaryPatterns,
            {
              group: ["@/shared/db/transaction", "**/shared/db/transaction"],
              message:
                "Do not open tenant transactions directly: define the operation with defineCommand/defineQuery (shared/usecase.ts) so session, authorization, validation and audit always run.",
            },
          ],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated Prisma client -- not hand-written, not our style rules.
    "generated/**",
  ]),
]);

export default eslintConfig;
