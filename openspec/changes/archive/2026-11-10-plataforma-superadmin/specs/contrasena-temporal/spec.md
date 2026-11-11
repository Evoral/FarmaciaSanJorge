## MODIFIED Requirements

### Requirement: Bootstrap del Administrador inicial de tenant

El Administrador inicial MUST crearse con la contraseña temporal (al menos 6 caracteres) que escribe quien da de alta
la farmacia -- el script create-tenant o el superadmin en `/plataforma` (`plataforma` P10) -- en estado ACTIVO con
debe_cambiar_password en true y sin códigos de activación; ambos caminos MUST usar `fsj.crear_tenant_interno`. La
contraseña nunca se muestra, registra ni audita en claro.

#### Scenario: Ejecución de create-tenant
- **GIVEN** la ejecución del script create-tenant para inicializar una farmacia
- **WHEN** se provee la contraseña temporal inicial
- **THEN** el Administrador nace en estado ACTIVO con debe_cambiar_password en verdadero y accede al flujo obligatorio en su primer inicio de sesión

#### Scenario: Alta desde la plataforma
- **GIVEN** el superadmin en el alta de farmacia de `/plataforma`
- **WHEN** escribe la contraseña temporal del Administrador y confirma
- **THEN** el Administrador nace igual que con el script, y la contraseña no aparece en la auditoría de plataforma
