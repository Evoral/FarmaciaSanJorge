# Tasks

- [x] 1. `limpiarPin` and `loadUsuarioParaRestablecerPin` in `modules/usuarios/infrastructure/usuario-repository.ts`; `cambiarEstadoUsuario` shares the same write
- [x] 2. `restablecerPin` command (`modules/usuarios/application/restablecer-pin.ts`)
- [x] 3. Server Action `restablecerPinAction` (no `conOperador`)
- [x] 4. «PIN» panel in the usuario detail (`modules/usuarios/ui/restablecer-pin.tsx`, `getUsuarioDetalle` PIN state)
- [x] 5. Permiso help text (`modules/usuarios/domain/ayuda-permisos.ts`)
- [x] 6. Unit tests (`tests/unit/usuarios-restablecer-pin.test.ts`)
- [x] 7. Browser check: reset, audit row, «Configurar PIN» step on the usuario's next login
- [x] 8. Merge the delta into `openspec/specs/contrasena-temporal/spec.md` and archive
