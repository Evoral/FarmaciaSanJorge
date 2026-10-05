/**
 * Guard for the camera of the QR import. Permissions-Policy is fixed per document
 * response, so a SOFT navigation to `/recetas/nuevo` keeps the `camera=()` of the page
 * it started from and the scanner could never open the camera (next.config.ts,
 * docs/specs/importacion-receta-qr.md). Soft navigations are:
 *   - a `<Link>` from "next/link";
 *   - `router.push/replace/prefetch` from `useRouter()` ("next/navigation");
 *   - `redirect()` / `permanentRedirect()` from "next/navigation": a Server Action's
 *     redirect is a client-side navigation too, it keeps the old document's policy.
 * The only entries that are full loads are a plain `<a href>` and `window.location`.
 *
 * The failure is silent at runtime (the link works, only the camera does not), so this
 * parses every .ts/.tsx under app/, modules/ and shared/ with the TypeScript compiler API
 * and looks at the real syntax: the `href` may be a literal, a template, a `{ pathname }`
 * object, or an identifier whose `const` initializer (same file or imported) is the route.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const RAIZ = path.resolve(__dirname, "../..");
const CARPETAS = ["app", "modules", "shared"];
const RUTA = "/recetas/nuevo";
/** The route, with or without a trailing slash, query or hash (a template head ends wherever its `${}` starts). */
const ES_RUTA = new RegExp(`^${RUTA}/?(?:[?#].*)?$`);
const MAX_PROFUNDIDAD = 5;

/** Reads a project file by its posix path relative to the repo root; `undefined` when it does not exist. */
type LeerArchivo = (ruta: string) => string | undefined;
interface Contexto {
  ruta: string;
  fuente: ts.SourceFile;
  leer: LeerArchivo;
}

const parsear = (ruta: string, texto: string) => ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ruta.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function buscar<T extends ts.Node>(raiz: ts.Node, esDelTipo: (nodo: ts.Node) => nodo is T): T[] {
  const encontrados: T[] = [];
  const visitar = (nodo: ts.Node) => {
    if (esDelTipo(nodo)) encontrados.push(nodo);
    ts.forEachChild(nodo, visitar);
  };
  visitar(raiz);
  return encontrados;
}

/** `./x`, `../x` and `@/x` to a project file (with the extensions and index files TypeScript would try). */
function resolverImport(desde: string, especificador: string, leer: LeerArchivo): string | null {
  let base: string;
  if (especificador.startsWith("@/")) base = especificador.slice(2);
  else if (especificador.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(desde), especificador));
  else return null; // a package
  return [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidata) => leer(candidata) !== undefined) ?? null;
}

/** Every string `expresion` may evaluate to, as far as a static read can tell (a template contributes its head). */
function valoresPosibles(expresion: ts.Expression, ctx: Contexto, profundidad = 0): string[] {
  if (profundidad > MAX_PROFUNDIDAD) return [];
  const siguiente = (e: ts.Expression) => valoresPosibles(e, ctx, profundidad + 1);
  if (ts.isStringLiteralLike(expresion)) return [expresion.text];
  if (ts.isTemplateExpression(expresion)) return [expresion.head.text];
  if (ts.isParenthesizedExpression(expresion) || ts.isAsExpression(expresion) || ts.isSatisfiesExpression(expresion) || ts.isNonNullExpression(expresion)) return siguiente(expresion.expression);
  if (ts.isBinaryExpression(expresion) && expresion.operatorToken.kind === ts.SyntaxKind.PlusToken) return siguiente(expresion.left);
  if (ts.isConditionalExpression(expresion)) return [...siguiente(expresion.whenTrue), ...siguiente(expresion.whenFalse)];
  if (ts.isObjectLiteralExpression(expresion)) {
    // `href={{ pathname: "/recetas/nuevo" }}` (a UrlObject)
    const pathname = expresion.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === "pathname");
    return pathname ? siguiente(pathname.initializer) : [];
  }
  if (ts.isIdentifier(expresion)) return valoresDeIdentificador(expresion.text, ctx, profundidad + 1);
  return [];
}

function valoresDeIdentificador(nombre: string, ctx: Contexto, profundidad: number): string[] {
  // `const NOMBRE = ...` anywhere in this file.
  const locales = buscar(ctx.fuente, ts.isVariableDeclaration).filter((d) => ts.isIdentifier(d.name) && d.name.text === nombre && d.initializer);
  const deConstantes = locales.flatMap((d) => valoresPosibles(d.initializer!, ctx, profundidad));
  // `import { NOMBRE } from "./x"` (or `import { OTRO as NOMBRE }`): the exported const of that file.
  const deImports = ctx.fuente.statements.flatMap((s) => {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || !s.importClause?.namedBindings || !ts.isNamedImports(s.importClause.namedBindings)) return [];
    const elemento = s.importClause.namedBindings.elements.find((e) => e.name.text === nombre);
    if (!elemento) return [];
    const destino = resolverImport(ctx.ruta, s.moduleSpecifier.text, ctx.leer);
    if (destino === null) return [];
    const texto = ctx.leer(destino)!;
    const otro: Contexto = { ruta: destino, fuente: parsear(destino, texto), leer: ctx.leer };
    return valoresDeIdentificador((elemento.propertyName ?? elemento.name).text, otro, profundidad);
  });
  return [...deConstantes, ...deImports];
}

/** Local names an import clause binds from `modulo`, filtered by what is imported (`"default"` or a named export). */
function nombresImportados(fuente: ts.SourceFile, modulo: string, importado: (nombre: string) => boolean): Set<string> {
  const nombres = new Set<string>();
  for (const s of fuente.statements) {
    if (!ts.isImportDeclaration(s) || !ts.isStringLiteral(s.moduleSpecifier) || s.moduleSpecifier.text !== modulo || !s.importClause) continue;
    if (s.importClause.name && importado("default")) nombres.add(s.importClause.name.text);
    const enlaces = s.importClause.namedBindings;
    if (enlaces && ts.isNamedImports(enlaces)) for (const e of enlaces.elements) if (importado((e.propertyName ?? e.name).text)) nombres.add(e.name.text);
  }
  return nombres;
}

interface Violacion {
  forma: "Link" | "router" | "redirect";
  linea: number;
}

/** Soft navigations to `/recetas/nuevo` in one source file. */
function navegacionesSuaves(ruta: string, texto: string, leer: LeerArchivo): Violacion[] {
  const fuente = parsear(ruta, texto);
  const ctx: Contexto = { ruta, fuente, leer };
  const apunta = (expresion: ts.Expression | undefined) => expresion !== undefined && valoresPosibles(expresion, ctx).some((v) => ES_RUTA.test(v));
  const linea = (nodo: ts.Node) => fuente.getLineAndCharacterOfPosition(nodo.getStart()).line + 1;
  const violaciones: Violacion[] = [];

  const nombresLink = nombresImportados(fuente, "next/link", (n) => n === "default");
  const nombresRedirect = nombresImportados(fuente, "next/navigation", (n) => n === "redirect" || n === "permanentRedirect");
  const nombresUseRouter = nombresImportados(fuente, "next/navigation", (n) => n === "useRouter");
  // `const router = useRouter()`: whatever the variable is called.
  const routers = new Set(
    buscar(fuente, ts.isVariableDeclaration)
      .filter((d) => ts.isIdentifier(d.name) && d.initializer && ts.isCallExpression(d.initializer) && ts.isIdentifier(d.initializer.expression) && nombresUseRouter.has(d.initializer.expression.text))
      .map((d) => (d.name as ts.Identifier).text),
  );

  const atributosDeEnlace = (nodo: ts.Node) => {
    if (!ts.isJsxOpeningElement(nodo) && !ts.isJsxSelfClosingElement(nodo)) return;
    if (!ts.isIdentifier(nodo.tagName) || !nombresLink.has(nodo.tagName.text)) return;
    for (const atributo of nodo.attributes.properties) {
      if (!ts.isJsxAttribute(atributo) || atributo.name.getText() !== "href" || !atributo.initializer) continue;
      const valor = ts.isJsxExpression(atributo.initializer) ? atributo.initializer.expression : atributo.initializer;
      if (apunta(valor)) violaciones.push({ forma: "Link", linea: linea(nodo) });
    }
  };

  const llamadas = (nodo: ts.Node) => {
    if (!ts.isCallExpression(nodo)) return;
    const { expression: llamado, arguments: argumentos } = nodo;
    if (ts.isIdentifier(llamado) && nombresRedirect.has(llamado.text) && apunta(argumentos[0])) violaciones.push({ forma: "redirect", linea: linea(nodo) });
    if (
      ts.isPropertyAccessExpression(llamado) &&
      ["push", "replace", "prefetch"].includes(llamado.name.text) &&
      ts.isIdentifier(llamado.expression) &&
      (routers.has(llamado.expression.text) || llamado.expression.text === "router") &&
      apunta(argumentos[0])
    ) {
      violaciones.push({ forma: "router", linea: linea(nodo) });
    }
  };

  const visitar = (nodo: ts.Node) => {
    atributosDeEnlace(nodo);
    llamadas(nodo);
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  return violaciones;
}

// ----------------------------------------------------------------------------
// Detector self-checks on in-memory sources (no project file is edited)
// ----------------------------------------------------------------------------
const IMPORT_LINK = `import Link from "next/link";\n`;
const detectar = (texto: string, otros: Record<string, string> = {}) =>
  navegacionesSuaves("app/(app)/x/page.tsx", texto, (ruta) => (ruta === "app/(app)/x/page.tsx" ? texto : otros[ruta]));

describe("navegacionesSuaves -- the detector sees every soft form it forbids", () => {
  it("a <Link> with the literal route, with or without trailing slash, query or hash", () => {
    for (const href of [RUTA, `${RUTA}/`, `${RUTA}?paciente=1`, `${RUTA}#form`]) {
      expect(detectar(`${IMPORT_LINK}export const A = () => <Link href="${href}">Nueva</Link>;`), href).toHaveLength(1);
    }
  });

  it("RED: <Link href={HREF_NUEVA_RECETA}> with a same-file const", () => {
    const fuente = `${IMPORT_LINK}const HREF_NUEVA_RECETA = "${RUTA}";\nexport const A = () => <Link href={HREF_NUEVA_RECETA}>Nueva</Link>;`;
    expect(detectar(fuente)).toEqual([{ forma: "Link", linea: 3 }]);
  });

  it("RED: <Link onClick={() => x} href=\"/recetas/nuevo\"> (the arrow's `>` before the href)", () => {
    expect(detectar(`${IMPORT_LINK}export const A = () => <Link onClick={() => x} href="${RUTA}">Nueva</Link>;`)).toHaveLength(1);
  });

  it("an aliased default import, a const through `as const` / a conditional, and a { pathname } object", () => {
    expect(detectar(`import Enlace from "next/link";\nexport const A = () => <Enlace href="${RUTA}">x</Enlace>;`)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}const H = ("${RUTA}" as const);\nexport const A = () => <Link href={H}>x</Link>;`)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}const H = ok ? "/recetas" : "${RUTA}";\nexport const A = () => <Link href={H}>x</Link>;`)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}export const A = () => <Link href={{ pathname: "${RUTA}", query: { a: 1 } }}>x</Link>;`)).toHaveLength(1);
  });

  it("a template literal that starts with the route, and a concatenation", () => {
    expect(detectar(`${IMPORT_LINK}export const A = () => <Link href={\`${RUTA}?paciente=\${id}\`}>x</Link>;`)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}export const A = () => <Link href={\`${RUTA}\${sufijo}\`}>x</Link>;`)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}export const A = () => <Link href={"${RUTA}" + "?a=1"}>x</Link>;`)).toHaveLength(1);
  });

  it("an imported const (relative, alias, renamed, one re-assignment deep)", () => {
    const otros = { "app/(app)/x/rutas.ts": `export const NUEVA = "${RUTA}";`, "shared/rutas.ts": `import { BASE as B } from "./base";\nexport const NUEVA = B;`, "shared/base.ts": `export const BASE = "${RUTA}";` };
    expect(detectar(`${IMPORT_LINK}import { NUEVA } from "./rutas";\nexport const A = () => <Link href={NUEVA}>x</Link>;`, otros)).toHaveLength(1);
    expect(detectar(`${IMPORT_LINK}import { NUEVA as N } from "@/shared/rutas";\nexport const A = () => <Link href={N}>x</Link>;`, otros)).toHaveLength(1);
  });

  it("router.push / router.replace / router.prefetch from useRouter(), whatever the variable is called", () => {
    const base = `import { useRouter } from "next/navigation";\nexport function A() {\n  const r = useRouter();\n`;
    for (const llamada of ["push", "replace", "prefetch"]) expect(detectar(`${base}  r.${llamada}("${RUTA}");\n}`), llamada).toEqual([{ forma: "router", linea: 4 }]);
    expect(detectar(`${base}  const H = "${RUTA}";\n  r.push(H);\n}`)).toHaveLength(1);
    expect(detectar(`export function A({ router }) {\n  router.replace("${RUTA}?a=1");\n}`)).toHaveLength(1);
  });

  it("redirect() and permanentRedirect() from next/navigation (a Server Action redirect is a soft navigation)", () => {
    expect(detectar(`import { redirect } from "next/navigation";\nexport async function accion() {\n  redirect("${RUTA}");\n}`)).toEqual([{ forma: "redirect", linea: 3 }]);
    expect(detectar(`import { permanentRedirect as ir } from "next/navigation";\nexport async function accion() {\n  ir(\`${RUTA}?x=\${y}\`);\n}`)).toHaveLength(1);
  });
});

describe("navegacionesSuaves -- what is allowed", () => {
  it("a plain <a href> (a full page load), even through the same const", () => {
    expect(detectar(`const H = "${RUTA}";\nexport const A = () => <a href={H}>x</a>;`)).toEqual([]);
    expect(detectar(`export const A = () => <a href="${RUTA}">x</a>;`)).toEqual([]);
  });

  it("window.location, and other routes next to it (/recetas, /recetas/nuevo-x, /recetas/123)", () => {
    expect(detectar(`export const ir = () => window.location.assign("${RUTA}");`)).toEqual([]);
    for (const href of ["/recetas", "/recetas/nuevox", "/recetas/123", "/pacientes/nuevo"]) {
      expect(detectar(`${IMPORT_LINK}export const A = () => <Link href="${href}">x</Link>;`), href).toEqual([]);
    }
  });

  it("a <Link> or redirect that does not come from next/*, and a route only mentioned in a comment or a string", () => {
    expect(detectar(`import Link from "./mi-enlace";\nexport const A = () => <Link href="${RUTA}">x</Link>;`)).toEqual([]);
    expect(detectar(`import { redirect } from "./util";\nexport function a() {\n  redirect("${RUTA}");\n}`)).toEqual([]);
    expect(detectar(`${IMPORT_LINK}// <Link href="${RUTA}"> is forbidden\nexport const TEXTO = "<Link href='${RUTA}'>";`)).toEqual([]);
  });
});

// ----------------------------------------------------------------------------
// The real sources
// ----------------------------------------------------------------------------
function archivosFuente(carpeta: string): string[] {
  return readdirSync(path.join(RAIZ, carpeta), { withFileTypes: true }).flatMap((entrada) => {
    const ruta = `${carpeta}/${entrada.name}`;
    if (entrada.isDirectory()) return archivosFuente(ruta);
    return /\.tsx?$/.test(entrada.name) ? [ruta] : [];
  });
}

const cache = new Map<string, string | undefined>();
const leerDeDisco: LeerArchivo = (ruta) => {
  if (!cache.has(ruta)) {
    const completa = path.join(RAIZ, ruta);
    cache.set(ruta, existsSync(completa) ? readFileSync(completa, "utf8") : undefined);
  }
  return cache.get(ruta);
};
const archivos = CARPETAS.flatMap(archivosFuente);
const PAGINA_RECETAS = "app/(app)/recetas/page.tsx";

describe("every entry into /recetas/nuevo is a full page load", () => {
  it("the scan reads the real sources and the route's entry point (it is not vacuous)", () => {
    expect(archivos.length).toBeGreaterThan(100);
    expect(archivos).toContain(PAGINA_RECETAS);
    expect(leerDeDisco(PAGINA_RECETAS)).toContain(RUTA);
  });

  it("no <Link>, router call or redirect() in app/, modules/ or shared/ points at /recetas/nuevo", () => {
    const encontrados = archivos.flatMap((ruta) => {
      const texto = leerDeDisco(ruta)!;
      if (!texto.includes("next/link") && !texto.includes("next/navigation")) return [];
      return navegacionesSuaves(ruta, texto, leerDeDisco).map((v) => `${ruta}:${v.linea} (${v.forma})`);
    });
    expect(encontrados).toEqual([]);
  });

  it("RED: the real /recetas page, with its <a> turned back into <Link>, would be caught", () => {
    const real = leerDeDisco(PAGINA_RECETAS)!;
    expect(navegacionesSuaves(PAGINA_RECETAS, real, leerDeDisco)).toEqual([]);
    expect(real).toContain("<a href={HREF_NUEVA_RECETA}");
    const regresion = `${IMPORT_LINK}${real.replaceAll("<a href={HREF_NUEVA_RECETA}", "<Link href={HREF_NUEVA_RECETA}")}`;
    expect(navegacionesSuaves(PAGINA_RECETAS, regresion, leerDeDisco).length).toBeGreaterThan(0);
  });
});
