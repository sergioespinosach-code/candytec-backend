# Editar un pedido para que coincida con la factura contable

Disponible para Facturación y Gerencia, incluso cuando el pedido ya está entregado.

1. Abre la ficha del pedido.
2. Pulsa **Editar pedido según factura contable**.
3. Selecciona la factura afectada.
4. Corrige productos, cantidades y precios. Si hay varias entregas de esa factura, cada línea indica su entrega.
5. Verifica la base y el IVA contra el documento contable. Estos importes son anteriores a cualquier nota de crédito. Cambiar cantidades o precios propone nuevos importes con el descuento general del pedido; revísalos antes de guardar.
6. Adjunta la factura e indica el motivo.
7. Pulsa **Registrar ajuste** y espera la confirmación del servidor.

Se actualizan las cantidades del pedido y de la entrega registrada. Se conservan el estado logístico, pagos, notas de crédito y las demás facturas. La ficha muestra las cantidades vigentes y la sección de facturación muestra el importe conciliado y el saldo real.

En un pedido parcial, se reemplaza únicamente la parte de la factura seleccionada: el remanente pendiente se conserva. No se puede dejar una entrega sin productos; anular una entrega requiere un procedimiento diferente.

El cambio queda registrado con responsable, fecha, motivo, respaldo y productos antes/después. Para corregir una conciliación anterior, registra otra conciliación; no se revierte aisladamente su importe.

La conciliación no crea movimientos físicos de inventario. Si la cantidad realmente despachada fue distinta, Bodega debe revisar y registrar el movimiento físico correspondiente.

Ante un fallo de conexión, el formulario conserva la operación para reintentar sin duplicarla. Un conflicto porque otro usuario cambió el pedido requiere volver a abrir el formulario con los datos actuales.

Aplicar después de candytec-corregir-guardado-pedidos.patch. Este parche no modifica server.js y necesita lib/order-summary.js de la corrección anterior.
