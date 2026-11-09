## MODIFIED Requirements

### Requirement: Bootstrap del Administrador inicial de tenant

El Administrador inicial de una farmacia MUST crearse con la contraseña temporal que escribe quien da de alta la farmacia
-- el script create-tenant (por argumento o consola) o el superadmin desde el alta de `/plataforma`
(`openspec/specs/plataforma/spec.md` P10) -- en estado ACTIVO con debe_cambiar_password en true, sin generar códigos de
activación. Ambos caminos MUST usar la misma función `fsj.crear_tenant_interno`. La contraseña temporal MUST cumplir la
política de contraseña temporal (al menos 6 caracteres) y nunca se muestra, registra ni audita en claro.

#### Scenario: Ejecución de create-tenant
- **GIVEN** la ejecución del script create-tenant para inicializar una farmacia
- **WHEN** se provee la contraseña temporal inicial
- **THEN** el Administrador nace en estado ACTIVO con debe_cambiar_password en verdadero y accede al flujo obligatorio en su primer inicio de sesión

#### Scenario: Alta desde la plataforma
- **GIVEN** el superadmin en el alta de farmacia de `/plataforma`
- **WHEN** escribe la contraseña temporal del Administrador y confirma
- **THEN** el Administrador nace igual que con el script, y la contraseña no aparece en la auditoría de plataforma
