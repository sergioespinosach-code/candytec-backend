# Mis productos

Disponible para los dos perfiles de Gerencia (rol interno `gerente`). Facturación, vendedores, jefe de ventas, bodega y producción continúan usando el catálogo activo en sus flujos habituales, pero no administran las fichas.

## Uso

- Abre **Mis productos** en el menú. Los productos existentes aparecen conservando sus IDs, nombres y peso para despachos; sus fichas empiezan pendientes de completar.
- Usa **Abrir** para completar SKU, marca, categoría, familia de fórmula, peso neto de pieza, peso de masa de caramelo, presentación de venta, unidades, peso neto por presentación y notas. Se permite guardar una ficha parcial.
- El nombre de un producto existente permanece fijo: pedidos, movimientos e inventario lo usan como vínculo. Para una presentación diferente, crea un nuevo SKU.
- Si no especificas SKU se asigna `CT-P-<id>`. Ese prefijo está reservado. Puedes usar un código propio distinto y único.
- **Familia de fórmula** agrupa bases compartidas. Por ejemplo, puedes escribir «Caramelo duro» en YumYum, DobleTwist y los chupetes que comparten esa masa; escribe «Toffee» para los productos que comparten esa base. Puedes crear otra familia escribiendo su nombre. Esta etapa todavía no comparte ni recalcula fórmulas entre SKUs.
- El peso unitario es el de una pieza completa. El peso de masa permite distinguirlo del polvo o relleno. No se permiten unidades fraccionarias por presentación ni peso de masa superior al de la pieza.
- El peso para despachos es **por unidad que ingresas al pedido**, habitualmente una funda o caja. Se mantiene separado y no se deduce automáticamente del peso unitario. Al completar una ficha existente, conserva este valor salvo que necesites corregirlo.
- Activos, Por completar y Archivados permiten organizar el trabajo. Una ficha se considera completa al tener marca, categoría, familia, peso unitario, presentación y contenido en unidades o kg; esto no certifica que sus datos hayan sido verificados.

## Crear, eliminar y restaurar

**Nuevo producto** crea el catálogo y su registro de producto terminado en una misma transacción. No duplica un ítem de inventario que ya exista con ese nombre. No inventa un saldo de stock.

**Eliminar del catálogo** archiva el producto: deja de aparecer para nuevos pedidos y nuevas fórmulas. Se conservan sus referencias históricas. Si tiene saldo distinto de cero, primero debe resolverse ese saldo en bodega. No ajustes el saldo a cero sin verificar físicamente las existencias.

En **Archivados → Ver / restaurar**, puedes devolverlo al catálogo con su mismo ID, nombre, SKU y ficha. No es necesario recrearlo.

Los ítems archivados de producto terminado con saldo cero dejan de aparecer en el listado habitual de inventario. Si un proceso anterior vuelve a dejarles existencias, el inventario vuelve a mostrarlas para evitar ocultar stock. Pedidos y despachos ya registrados se conservan y siguen siendo consultables.

**Historial** muestra autor, fecha y ficha en cada guardado, archivo o restauración. Los reintentos usan una misma operación para evitar duplicados; si otra persona modificó la ficha, se pide volver a abrirla.

## Instalación

Este parche requiere el módulo anterior de **Centro de costos y Control de gastos**. Reutiliza su validación de gerencia, historial y prevención de duplicados.

Agrega `lib/product-master.js`, modifica `server.js`, `frontend/index.html` y `lib/business-control.js`, y agrega pruebas y esta guía. Al iniciar se añaden SKU, ficha, estado activo y versión al catálogo; no se eliminan productos durante la migración. Los SKU iniciales se generan a partir de los IDs existentes.

La sección de catálogo en Configuración enlaza a Mis productos. Las rutas antiguas de escritura devuelven un mensaje para actualizar la página y usar el nuevo módulo, evitando que una pestaña antigua elimine físicamente productos o sobrescriba pesos sin control de versión.

## Verificación

Se probaron validaciones, creación, conservación de vínculos, archivo con/sin stock, restauración, permisos, rollback, control de versiones y reintentos. Se usa una base de datos simulada y DOM simulado, no la base de producción de Render.

Después del despliegue, entra como gerencia, completa una ficha existente, guarda y recarga. Comprueba el historial y confirma que el peso del producto en el planificador permanece igual. Las categorías y marcas no se asignan automáticamente: las completa Gerencia.
