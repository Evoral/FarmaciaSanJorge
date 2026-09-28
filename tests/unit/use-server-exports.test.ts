/**
 * Guard: a `"use server"` module may only export async functions (plus
 * type-only exports, which are erased). Exporting anything else -- e.g. a
 * form's initial state object -- compiles and typechecks fine but crashes
 * at runtime with Next's "A 'use server' file can only export async
 * functions" (invalid-use-server-value). Initial form states belong in the
 * client component that calls `useActionState`.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const ROOT = path.resolve(__dirname, "../..");
const SCAN_DIRS = ["app", "modules", "shared"];

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...listSourceFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function isUseServerModule(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (!ts.isExpressionStatement(stmt) || !ts.isStringLiteral(stmt.expression)) return false;
    if (stmt.expression.text === "use server") return true;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isAsyncFunctionExpression(expr: ts.Expression | undefined): boolean {
  return !!expr && (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) && hasModifier(expr, ts.SyntaxKind.AsyncKeyword);
}

/** Names bound at module level to an async function (declaration or `const x = async () => ...`). */
function localAsyncFunctions(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && hasModifier(stmt, ts.SyntaxKind.AsyncKeyword)) names.add(stmt.name.text);
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && isAsyncFunctionExpression(decl.initializer)) names.add(decl.name.text);
      }
    }
  }
  return names;
}

function invalidExports(sf: ts.SourceFile): string[] {
  const asyncLocals = localAsyncFunctions(sf);
  const bad: string[] = [];
  for (const stmt of sf.statements) {
    const exported = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;
    if (exported && ts.isFunctionDeclaration(stmt)) {
      if (!hasModifier(stmt, ts.SyntaxKind.AsyncKeyword)) bad.push(stmt.name?.text ?? "default");
    } else if (exported && ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (!isAsyncFunctionExpression(decl.initializer)) bad.push(decl.name.getText(sf));
      }
    } else if (exported && (ts.isClassDeclaration(stmt) || ts.isEnumDeclaration(stmt))) {
      bad.push(stmt.name?.text ?? "default");
    } else if (ts.isExportDeclaration(stmt) && !stmt.isTypeOnly) {
      if (!stmt.exportClause || !ts.isNamedExports(stmt.exportClause)) {
        bad.push(`export * from ${stmt.moduleSpecifier?.getText(sf)}`);
        continue;
      }
      for (const spec of stmt.exportClause.elements) {
        if (spec.isTypeOnly) continue;
        const local = (spec.propertyName ?? spec.name).text;
        if (stmt.moduleSpecifier || !asyncLocals.has(local)) bad.push(spec.name.text);
      }
    } else if (ts.isExportAssignment(stmt)) {
      if (!isAsyncFunctionExpression(stmt.expression) && !(ts.isIdentifier(stmt.expression) && asyncLocals.has(stmt.expression.text))) bad.push("default");
    }
  }
  return bad;
}

describe('"use server" modules', () => {
  const files = SCAN_DIRS.flatMap((d) => listSourceFiles(path.join(ROOT, d)))
    .map((file) => ({ file, sf: ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS) }))
    .filter(({ sf }) => isUseServerModule(sf));

  it("finds the server action modules", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("export only async functions (or types)", () => {
    const violations = files.flatMap(({ file, sf }) => invalidExports(sf).map((name) => `${path.relative(ROOT, file)}: ${name}`));
    expect(violations).toEqual([]);
  });
});
