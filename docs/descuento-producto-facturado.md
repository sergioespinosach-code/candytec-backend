# Corregir descuentos por producto después de facturar

Esta ampliación se instala después de `candytec-notas-credito-y-ajustes.patch`.

En un pedido facturado, incluso entregado, abre **Ajustes de facturación → Corregir descuento por producto**. Facturación y ambos perfiles de Gerencia conservan el acceso autorizado por el servidor.

1. Selecciona la factura afectada.
2. En cada producto, indica un descuento porcentual o en dólares sobre el total de ese producto, no por unidad. Los productos sin descuento quedan en cero.
3. Comprueba la base final y el IVA final. El sistema propone un IVA proporcional al registrado en esa factura; copia el importe exacto del documento contable si hay diferencias de redondeo o tratamiento tributario. Puede ser cero.
4. Indica número y fecha de la factura, motivo y adjunta la factura contable.
5. Revisa la vista previa del saldo y registra el ajuste.

Ejemplo: 10 bultos a $100 suman $1.000. Un descuento de 10 % deja $900 de base. Si corresponde IVA de $135, la factura queda en $1.035. Los demás productos de la factura conservan sus importes salvo que también les indiques descuento.

La base inicial de cada producto ya contempla el descuento general del pedido. Estos descuentos son adicionales a ese descuento general. Si un producto aparece en varias líneas, se agrupa su cantidad facturada y se usa el precio promedio ponderado; esta versión no distingue descuentos diferentes entre líneas del mismo nombre.

Se guarda como una corrección de registro de la factura, no como una nota de crédito. El historial incluye producto, cantidad, base anterior, tipo y valor de descuento y base final. No se modifican las cantidades del pedido, sus entregas, movimientos de inventario o abonos. Los valores netos y saldos se actualizan en los resúmenes incorporados por el módulo financiero.

Al volver a corregir un descuento, se precarga el descuento vigente y se reemplaza su efecto; no se descuenta de nuevo sobre una base ya descontada. Se puede revertir el registro desde el historial. Las notas de crédito previamente registradas siguen descontándose por separado: no dupliques el mismo descuento por ambas vías.

Si existe una corrección global de base que no tiene desglose por producto compatible, el sistema pide conciliarla mediante **Corregir valores registrados** antes de aplicar descuentos por producto. Así no se pierde silenciosamente una corrección anterior.

El cálculo de la base y la validación de productos se realizan también en el servidor. Se rechazan productos ajenos, productos repetidos, porcentajes superiores a 100 y descuentos en dólares superiores a la base del producto. Se conservan los controles existentes de permisos, versión, transacciones, reintentos e historial. Los rankings por producto siguen mostrando importes brutos según el alcance del módulo anterior; el detalle del descuento queda en el historial de cada factura.

Verificación: `node --test tests/order-finance.test.js tests/product-discount.test.js`. Las 16 pruebas cubren reglas anteriores y nuevas, incluyendo pedidos entregados, facturación parcial, IVA cero, repetición de correcciones y reversión. La prueba de paridad verifica que las reglas del HTML coincidan con las del servidor. No se verificó el despliegue real en Render.
