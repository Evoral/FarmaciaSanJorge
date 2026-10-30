# Design: Corregir pureza de una partida

## Technical Approach

We follow the exact pattern established by `corregirCostoPartida` (`modules/stock/application/corregir-costo-partida.ts`), extending it to `potencia_declarada`.

### 1. Database & Permissions

`fsj.partida.potencia_declarada` already has a check constraint (`partida_potencia_declarada_check CHECK (potencia_declarada IS NULL OR (potencia_declarada > 0 AND potencia_declarada <= 100))`).
However, migration 0058 left it without an UPDATE grant for `fsj_app`.

We add a forward migration:
```sql
GRANT UPDATE (potencia_declarada) ON fsj.partida TO fsj_app;
```
Rollback script:
```sql
REVOKE UPDATE (potencia_declarada) ON fsj.partida FROM fsj_app;
```

### 2. Application Permission

We define a new permission in `modules/auth/domain/permisos.ts`:
- Name: `"stock.partida.potencia.corregir"`
- Category: `"gestion"` (or `"operativo"`).
- Default roles: `ADMINISTRADOR`, `DIRECTOR_TECNICO`.

### 3. Application Command: `corregirPotenciaPartida`

File: `modules/stock/application/corregir-potencia-partida.ts`
- Pattern: `defineCommand` (`shared/usecase.ts`).
- Schema validation with zod:
  - `id`: UUID.
  - `potenciaDeclaradaNueva`: optional string. If empty string or "100", maps to `null` (no correction). If provided, validates `> 0` and `<= 100` with decimal precision.
  - `motivo`: non-empty string.
- Transaction flow:
  1. `lockPartidaParaAccion(tx, session.tenantId, input.id)`.
  2. `getPartidaParaAccion(tx, session.tenantId, input.id)` to fetch current state.
  3. Guard: Check `dec(partida.cantidadReservada).greaterThan(0)`. If true, throw `DomainError("La partida tiene reservas activas en preparaciones en curso. Confirmá o descartá las preparaciones antes de corregir la pureza.")`.
  4. Optimistic update: `updatePotenciaPartida(tx, { tenantId, id, potenciaNueva, potenciaAnterior })`.
  5. Audit record: entity `"partida"`, action `MODIFICAR`, with `valorAnterior: { potenciaDeclarada }`, `valorNuevo: { potenciaDeclarada }`, `motivo`.

### 4. Repository Functions

File: `modules/stock/infrastructure/partida-repository.ts`
- `updatePotenciaPartida`:
  ```ts
  await tx.partida.updateMany({
    where: {
      id: input.id,
      tenantId: input.tenantId,
      potenciaDeclarada: input.potenciaAnterior ? new Prisma.Decimal(input.potenciaAnterior) : null,
    },
    data: {
      potenciaDeclarada: input.potenciaNueva ? new Prisma.Decimal(input.potenciaNueva) : null,
    },
  });
  ```

### 5. UI Layer

1. Component: `modules/stock/ui/corregir-potencia-form.tsx`
   - Reuses `SimpleForm` from `@/shared/ui/simple-form`.
   - Action: `corregirPotenciaPartidaAction` (Server Action in `modules/stock/ui/actions.ts`).
   - Fields:
     - Hidden `id`.
     - Numeric input `potenciaDeclaradaNueva` with current value in helper text.
     - Textarea `motivo`.
2. Page Integration: `app/(app)/partidas/[id]/page.tsx`
   - Check `can(session, "stock.partida.potencia.corregir")`.
   - Render a panel "Corregir pureza" under "Corregir costo" in the sidebar aside.
