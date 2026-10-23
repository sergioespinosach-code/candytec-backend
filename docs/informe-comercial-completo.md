# Informe comercial completo

Dashboard → Exportar y análisis → Informe comercial completo. Elige Desde y Hasta; descarga PDF o Excel. Acceso: Gerencia y Jefatura de ventas, igual que el análisis global.

Incluye todos los productos y vendedores, cantidades, promedio ponderado antes/después de descuentos por presentación, precios menor/mayor del detalle, ventas por vendedor, participación, clientes compradores, ticket por pedido, comparación anterior, semanas y meses, vendedor por semana/mes, clientes, ciudades, conciliación y observaciones. Excel: 15 hojas con valores numéricos, filtros, facturas y detalle de productos.

## Criterios

- Fecha del pedido, no fecha de emisión contable. Rango inclusivo. Período anterior de igual número de días. Semanas lunes-domingo; períodos vacíos en cero y extremos parciales identificados.
- Ventas netas sin IVA usando CandyFinance: base corregida menos notas de crédito vigentes. Incluye facturas parciales sin cabecera, snapshots y reversos; agrupa entregas de la misma factura una sola vez por pedido.
- Precio ponderado: importe identificable del producto / unidades facturadas con precio. Respeta descuentos del pedido y correcciones por producto con detalle consistente. Unidad = presentación comercial, no pieza individual.
- Correcciones globales y NC sin desglose NO se atribuyen arbitrariamente al producto. Se muestran separadas para que detalle + ajustes = venta neta. Esos ajustes no alteran promedios ni cantidades. No se infieren devoluciones físicas.
- Fuentes con detalle incompleto se identifican; no se presenta un precio faltante como cero. Snapshots sin detalle conservan el importe neto.
- Asignación actual de vendedor/cliente. Una reasignación puede modificar agrupaciones del historial. Fechas inválidas excluidas y contadas; cancelados/anulados excluidos. Sin venta anterior positiva, variación = no comparable, nunca 100% inventado.
- Cartera actual y stock bajo mínimo son indicadores globales del momento de exportar, no del cierre del período.
- El informe es de análisis comercial con los datos registrados; no sustituye un mayor contable por fechas de factura/NC.

## Validación

`node --test tests/sales-report.test.js tests/order-seller-sales.test.js`

El cálculo está en lib/sales-report-core.js y se incrusta idéntico en frontend/index.html para no añadir otra petición al cargar la aplicación. Al modificarlo, sincronizar ambos; la prueba compara sus bytes.

Sin cambios de base de datos ni escrituras en pedidos, inventario o facturas. El parche se limita al informe y a su botón Excel; no incluye la reparación pendiente de productos retirados de bodega.
