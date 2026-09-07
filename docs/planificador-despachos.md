# Planificador de despachos de CandyTec

Esta actualización añade una pantalla de planificación y una tabla independiente de planes. Se instala sobre la versión del proyecto con el Excel «Por facturar» (commit comunicado: c2555b1).

## Uso

1. Abrir **Planificador de despachos** en el menú y pulsar **Nuevo plan**.
2. Filtrar por cliente/pedido/vendedor, ciudad, sector, fecha de entrega o estado.
3. Añadir pedidos por facturar o entregas facturadas pendientes de salida.
4. Ajustar cantidades de lo que todavía no está facturado. Las entregas ya facturadas se incluyen completas.
5. Indicar nombre de carga, fecha de salida, vehículo/placa, conductor, capacidad útil en kg y, opcionalmente, costo estimado y observaciones.
6. Revisar el peso, los faltantes y las paradas. Las flechas cambian el orden de preparación/ruta.
7. Guardar un **Borrador** o **Confirmar plan**. El borrador permite datos pendientes. Confirmar exige vehículo, conductor, capacidad positiva, pesos completos y carga dentro de capacidad.
8. Descargar el **Excel de carga** o imprimir la **hoja de ruta**, una vez guardado. La impresión del navegador permite guardar como PDF.
9. Facturación y Bodega continúan con las acciones habituales del pedido. La planificación muestra los estados actuales cuando se consultan datos.
10. Cerrar o cancelar el plan cuando corresponda. Esto libera cantidades planificadas; no registra una salida física ni una entrega.

Un plan confirmado puede contener producto pendiente de facturar o fabricar: es una programación, no una confirmación de que todo está disponible. Los avisos deben resolverse antes de preparar la salida.

## Permisos

| Rol | Consultar | Guardar, editar, confirmar, cerrar o cancelar |
| --- | --- | --- |
| Gerencia | Sí | Sí |
| Facturación | Sí | Sí |
| Bodega | Sí | Sí |
| Jefatura de Ventas | Sí | No |
| Producción | Sí | No |
| Vendedores | No | No |

El servidor comprueba el rol actual de la cuenta. La antigua ruta de registro público de usuarios queda restringida a la cuenta administradora; la pantalla de administración conserva su ruta existente.

## Reglas y límites

- Los planes abiertos incluyen borradores y planes confirmados. Ambos asignan cantidades para impedir duplicación entre planes.
- Las asignaciones corresponden a pedido/producto pendiente o a una entrega facturada específica.
- Si un pedido cambia tras guardarse, el plan se marca para revisión. Cuando se factura un pedido planificado, puede ser necesario quitar la selección pendiente y añadir su entrega facturada. Esta reconciliación es explícita, no automática.
- Se impide reasignar un pedido desde otro plan si existe un plan abierto que necesita esa revisión. Abrir, corregir o cancelar el plan anterior permite continuar.
- El resumen de stock descuenta la demanda de otros planes abiertos de las existencias consultadas. Es una previsión; no crea reservas físicas ni modifica inventario.
- El cálculo de carga utiliza `peso_bulto` del catálogo. Debe representar el peso apropiado por unidad comercial. Si falta, se permite un borrador y se impide confirmar una carga con peso incompleto.
- El costo de transporte es una estimación del plan y no actualiza los costos logísticos reales de las entregas.
- Se puede editar el orden de paradas manualmente; no se calculan rutas por mapas ni distancias.
- El usuario conserva los cambios de la carga al navegar entre pantallas. El navegador advierte al cerrar o recargar con cambios sin guardar.
- Los documentos se generan a partir de un plan guardado, consultan los datos actuales y comprueban su versión. Son copias de planificación; editar un Excel no actualiza el sistema.
- Se muestran todos los planes abiertos y los 50 archivados más recientes. Los demás permanecen en la base de datos.
- Los errores generales de permisos, cobranzas e inventario anteriores descritos en la revisión no quedan resueltos integralmente por este módulo. La salida física sigue usando el flujo anterior de Bodega.

## Instalación y datos

No incorpora dependencias nuevas de producción. Al iniciar el servidor se crea, si no existe, `dispatch_plans` y su índice. No se ejecutan comandos de reinicio ni se modifican registros de pedidos o stock durante la instalación.

Se requieren `server.js`, `lib/dispatch-planner.js`, `lib/planner-core.js` y `frontend/index.html` de la misma actualización. Publicar el backend junto con la interfaz. Si el frontend tiene un despliegue independiente, publicar también su nueva versión.

Cada actualización del plan exige su versión vigente. Las escrituras de asignaciones usan una transacción y bloqueo asesor de PostgreSQL; se validan pedidos e inventario actuales. Un identificador de operación evita duplicar un alta al reintentar tras una respuesta perdida.

## Verificación

Pruebas sin dependencias adicionales, con Node 18 o superior:

```bash
node --check server.js
node --check lib/dispatch-planner.js
node --test tests/planner-core.test.js
```

También se probaron en desarrollo los endpoints mediante HTTP real, un motor PostgreSQL local PGlite y un DOM simulado con datos de ejemplo: permisos, guardado, versiones, capacidad, peso faltante, reintentos, rollback, asignaciones, cancelación y generación de datos de Excel. PGlite usa una conexión de prueba serializada; eso no sustituye una prueba de concurrencia entre sesiones en la base de Render. No se verificó el diseño en un navegador visual ni contra la base real de la empresa.

Después del despliegue: comprobar acceso con Gerencia, crear un borrador pequeño, reabrirlo, revisar peso/faltantes y descargar su Excel. Cancelar ese plan de prueba al terminar. Confirmar que el stock físico no cambia al planificar.

## Mantenimiento

Las reglas puras están en `lib/planner-core.js`. Se incluyen también dentro del HTML para mantener el modo de publicación actual sin otra descarga de scripts. Después de editar esas reglas:

```bash
node scripts/sync-planner-core.js
node --test tests/planner-core.test.js
```

La prueba de equivalencia detecta diferencias entre las reglas del navegador y del servidor.
