# Propuesta — Chat de ayuda interno

> **Estado:** propuesta aprobada para planificar (User decision 2026-10-28). No implementada.

## Por qué

Los empleados preguntan "¿cómo hago X?" con su propio vocabulario ("¿dónde pongo lo de la obra social?"). Hoy la
respuesta depende de que alguien sepa en qué pantalla está cada acción. Queremos un chat dentro de la app que entienda
la pregunta en lenguaje natural y responda **cómo llegar** a la acción: sección, botón y, si hace falta, un detalle.

## Qué hace

- Un botón de ayuda en la app abre un chat. El usuario pregunta; la respuesta es corta y dice dónde ir y qué tocar,
  con un botón "Ir a …" que lleva a la pantalla.
- Admite repreguntas sobre lo mismo ("no entiendo cómo importar el PDF").
- Un LLM barato (Gemini 3.5 Flash-Lite, configurable) interpreta la pregunta y redacta la respuesta, **solo** a partir de una guía de
  uso escrita y revisada por nosotros. No inventa pantallas, botones ni rutas.

## Decisiones del usuario (2026-10-28)

1. **El LLM es intérprete y redactor, no fuente.** Se acepta el formato conversacional humano, pero todo lo que
   responde sale de la guía.
2. **La guía es global y estática:** datos tipados en el código, iguales para todas las farmacias. No vive en la base
   (no rompe RLS ni necesita `tenant_id`) y se versiona con la UI que describe.
3. **Filtro estricto por permisos antes del LLM:** el modelo nunca recibe entradas que el usuario no puede hacer, ni
   siquiera su título. Ante una acción no permitida muestra el cartel de derivación (decisión 7).
4. **Contexto en dos niveles** (elegido frente a búsqueda difusa, router LLM de dos llamadas, embeddings y "toda la
   guía en cada consulta"): en cada turno va un índice compacto de las entradas permitidas y solo los detalles de la
   entrada en foco de la conversación. Una sola llamada por turno en el caso normal, prefijo estable para aprovechar el
   cache implícito del proveedor.
5. **Sin datos del negocio:** el LLM no ve recetas, pacientes ni stock; solo la guía y la conversación.
6. **Permiso asignable:** `ayuda.consultar` es un permiso de consulta común. ADMINISTRADOR lo recibe automáticamente;
   cada farmacia lo habilita en los demás roles desde el editor de roles.
7. **Orientar en vez de bloquear, sin circuito de respuesta:** si la pregunta queda fuera de las opciones del usuario,
   el chat muestra un cartel fijo que le sugiere preguntarle a su director técnico o al administrador. No hay envío de
   consultas ni bandeja para responderlas.
8. **Registro de consultas para medir el modelo:** se guardan pregunta, respuesta, entrada elegida, resultado y la
   calificación "¿Te sirvió?". El registro es **solo del dueño de la plataforma**: ningún usuario de las farmacias lo ve
   (ni ADMINISTRADOR ni DT). Se revisa por SQL hasta que exista el panel de administración de la plataforma.
9. **Control de consumo en el proveedor, sin límite en la app:** los presupuestos de Cloud Billing solo envían alertas
   y no frenan peticiones. El límite duro se configura como un tope (override) a la cuota diaria de requests de la
   Generative Language API en el proyecto de Google Cloud, complementado con alertas de gasto en Facturación. Se
   recomienda un proyecto y clave dedicados a esta app para no compartir cuotas ni alertas con otros consumos. En la app
   sigue sin haber límite de consultas (un consumo alto indica que se está usando mucho).
10. **Retención del registro:** se conserva sin vencimiento hasta que el dueño de la plataforma decida eliminarlo. No
    hay purga automática.

## Alcance

- Módulo nuevo `modules/ayuda` (guía, filtro, armado del contexto, cliente del LLM, casos de uso, UI del chat).
- Tabla `fsj.consulta_ayuda` y permiso nuevo `ayuda.consultar`.
- Guía inicial con los flujos de uso diario, redactada a partir de las specs y revisada por el usuario.

## Fuera de alcance

- Responder sobre datos de la farmacia ("¿cuánto stock hay de…?").
- Ejecutar acciones desde el chat.
- El panel de administración de la plataforma para revisar el registro (se planifica aparte).
- Buscar por embeddings o en una guía de miles de entradas.

## Decisiones pendientes

- **Precio vigente del proveedor (verificado 2026-10-28, https://ai.google.dev/gemini-api/docs/pricing):** `gemini-3.5-flash-lite` (igual que `gemini-2.5-flash`, que Google no habilita a claves sin uso previo de los 2.5) en nivel pago cuesta USD 0,30 por 1M tokens de entrada, USD 2,50 por 1M tokens de salida (pensamiento incluido) y USD 0,03 por 1M tokens de entrada cacheada (cache implícito activo por defecto).
- **Crear la clave en un proyecto de Cloud con facturación, cuota diaria de requests y alertas de gasto (lo hace el usuario).**
