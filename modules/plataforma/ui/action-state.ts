/** Server Action result shape for `/plataforma`. Own copy per module, like modules/repartidores/ui/action-state.ts. */
export type PlataformaActionState =
  | { status: "idle" }
  | { status: "error"; message: string; fields?: string[]; href?: string }
  | { status: "success"; message?: string; tenantId?: string };
