/**
 * `listPacientesRecurrentes` through the REAL `execute()` path with a mocked
 * repository: windowing, pagination, the WhatsApp availability per row (and
 * that the raw phone never leaves the use case), and the input contract. No DB.
 */
import { describe, it, expect, vi } from "vitest";
import type { AuthenticatedSession } from "@/shared/auth/session";
import type { ItemRecurrenteCrudo, PacienteRecurrenteCrudo, RecurrentesCrudos } from "@/modules/pacientes/domain/recurrentes";

vi.mock("@/shared/audit", () => ({
  record: vi.fn(async () => undefined),
  TipoAccion: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("@/shared/db/transaction", () => ({
  withTenantTransaction: async (tenantId: string, fn: (tx: unknown) => unknown) => fn({ __fakeTx: true, tenantId }),
}));
vi.mock("@/shared/auth/session", () => ({
  requireSession: vi.fn(async () => {
    throw new Error("requireSession() unexpectedly called -- inject a session via execute(input, { session })");
  }),
  requireRecentReauth: vi.fn(),
}));

const getRecurrentesCrudosMock = vi.fn<(tx: unknown, tenantId: string, ahora: Date) => Promise<RecurrentesCrudos>>();
vi.mock("@/modules/pacientes/infrastructure/recurrentes-repository", () => ({
  getRecurrentesCrudos: (tx: unknown, tenantId: string, ahora: Date) => getRecurrentesCrudosMock(tx, tenantId, ahora),
}));

const { listPacientesRecurrentesQuery } = await import("@/modules/pacientes/application/list-pacientes-recurrentes");

const TENANT = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;

function session(permisos: string[]): AuthenticatedSession {
  return {
    usuario: { id: "u1", email: "a@example.com", nombre: "N", apellido: "A" },
    tenantId: TENANT,
    sesionId: "s1",
    permisos: new Set(permisos) as AuthenticatedSession["permisos"],
    reautenticadaEn: new Date(),
  };
}
const GESTIONA = session(["pacientes.gestionar"]);

/** A receta `diasAtras` days before now (12:00 local ~ 15:00Z keeps the local day stable). */
const hace = (diasAtras: number) => new Date(new Date().setUTCHours(15, 0, 0, 0) - diasAtras * DAY);

function paciente(id: string, over: Partial<PacienteRecurrenteCrudo> = {}): PacienteRecurrenteCrudo {
  return { id, nombre: `Nombre ${id}`, apellido: `Apellido ${id}`, telefono: "011 15-1234-5678", aceptaRecordatoriosWhatsapp: true, fechaBaja: null, ...over };
}

/** Two recetas of the same fórmula: the last one `ultimoHace` days ago, with a 28-day interval (próxima = 28 - ultimoHace days from today). */
function recurrente(p: PacienteRecurrenteCrudo, ultimoHace: number): ItemRecurrenteCrudo[] {
  return [ultimoHace + 28, ultimoHace].map((dias, k) => ({
    id: `${p.id}-item-${k}`,
    descripcion: "Fórmula magistral",
    formaFarmaceutica: "CAPSULA" as const,
    duracionTratamientoDias: null,
    componentes: [],
    receta: { id: `${p.id}-receta-${k}`, fechaIngreso: hace(dias), estado: "ENTREGADA" as const },
    paciente: p,
  }));
}

function crudos(items: ItemRecurrenteCrudo[]): RecurrentesCrudos {
  return { zonaHoraria: "UTC", farmaciaNombre: "Farmacia San José", items };
}

async function run(input: unknown, items: ItemRecurrenteCrudo[]) {
  getRecurrentesCrudosMock.mockResolvedValue(crudos(items));
  return listPacientesRecurrentesQuery.execute(input, { session: GESTIONA });
}

describe("pacientes.recurrentes", () => {
  it("is registered on pacientes.gestionar and rejects a session without it", async () => {
    expect(listPacientesRecurrentesQuery.permiso).toBe("pacientes.gestionar");
    getRecurrentesCrudosMock.mockClear();
    await expect(listPacientesRecurrentesQuery.execute({}, { session: session([]) })).rejects.toThrow();
    expect(getRecurrentesCrudosMock).not.toHaveBeenCalled();
  });

  it("scopes the read to the session's tenant", async () => {
    await run({}, []);
    expect(getRecurrentesCrudosMock).toHaveBeenLastCalledWith(expect.anything(), TENANT, expect.any(Date));
  });

  it("the default window is próximos (ATRASADO + ESTA_SEMANA); 'todos' adds MAS_ADELANTE; counts cover both", async () => {
    const items = [
      ...recurrente(paciente("atrasado"), 40), // próxima 12 days ago
      ...recurrente(paciente("semana"), 24), // próxima in 4 days
      ...recurrente(paciente("luego"), 5), // próxima in 23 days
    ];
    const proximos = await run({}, items);
    expect(proximos.ventana).toBe("proximos");
    expect(proximos.filas.map((f) => [f.pacienteId, f.estado])).toEqual([
      ["atrasado", "ATRASADO"],
      ["semana", "ESTA_SEMANA"],
    ]);
    expect(proximos.conteo).toEqual({ proximos: 2, todos: 3 });

    const todos = await run({ ventana: "todos" }, items);
    expect(todos.filas.map((f) => f.pacienteId)).toEqual(["atrasado", "semana", "luego"]);
    expect(todos.paginacion.total).toBe(3);
  });

  it("paginates 20 per page and clamps an out-of-range page to the last one", async () => {
    const items = Array.from({ length: 23 }, (_, i) => recurrente(paciente(`p${String(i).padStart(2, "0")}`), 40)).flat();
    const primera = await run({ page: 1 }, items);
    expect(primera.filas).toHaveLength(20);
    expect(primera.paginacion).toMatchObject({ page: 1, totalPages: 2, total: 23 });
    const ultima = await run({ page: 99 }, items);
    expect(ultima.filas).toHaveLength(3);
    expect(ultima.paginacion.page).toBe(2);
  });

  it("offers WhatsApp (with the wa.me link) only with consent and a valid phone; otherwise the reason", async () => {
    const items = [
      ...recurrente(paciente("ok"), 40),
      ...recurrente(paciente("sin-consent", { aceptaRecordatoriosWhatsapp: false }), 40),
      ...recurrente(paciente("sin-tel", { telefono: null }), 40),
      ...recurrente(paciente("tel-malo", { telefono: "4123-4567" }), 40),
    ];
    const { filas } = await run({}, items);
    const por = Object.fromEntries(filas.map((f) => [f.pacienteId, f.whatsapp]));

    expect(por["ok"]).toMatchObject({ disponible: true });
    const url = (por["ok"] as { url: string }).url;
    expect(url.startsWith("https://wa.me/5491112345678?text=")).toBe(true);
    const mensaje = decodeURIComponent(url.slice(url.indexOf("?text=") + 6));
    expect(mensaje).toContain("Hola Nombre ok, te escribimos de Farmacia San José.");
    expect(mensaje).toContain("tu preparado de Fórmula magistral.");

    expect(por["sin-consent"]).toEqual({ disponible: false, motivo: "SIN_CONSENTIMIENTO" });
    expect(por["sin-tel"]).toEqual({ disponible: false, motivo: "SIN_TELEFONO" });
    expect(por["tel-malo"]).toEqual({ disponible: false, motivo: "TELEFONO_INVALIDO" });
  });

  it("never returns the raw phone: rows carry only the wa.me URL or the reason", async () => {
    const { filas } = await run({}, recurrente(paciente("ok", { telefono: "011 15-1234-5678" }), 40));
    expect(JSON.stringify(filas)).not.toContain("011 15-1234-5678");
    expect(filas[0]).not.toHaveProperty("telefono");
    expect(filas[0]).not.toHaveProperty("paciente");
  });

  it("rejects an invalid ventana or page (ValidationError, nothing read)", async () => {
    getRecurrentesCrudosMock.mockClear();
    await expect(listPacientesRecurrentesQuery.execute({ ventana: "ayer" }, { session: GESTIONA })).rejects.toThrow(/Datos inválidos/);
    await expect(listPacientesRecurrentesQuery.execute({ page: 0 }, { session: GESTIONA })).rejects.toThrow(/Datos inválidos/);
    await expect(listPacientesRecurrentesQuery.execute({ page: 1.5 }, { session: GESTIONA })).rejects.toThrow(/Datos inválidos/);
    expect(getRecurrentesCrudosMock).not.toHaveBeenCalled();
  });
});
