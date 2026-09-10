# Registro de notas de crédito y ajustes de facturación

CandyTec registra documentos emitidos en el sistema contable externo. No emite, transmite ni anula documentos fiscales.

## Acceso y uso

Abre un pedido que tenga factura y pulsa **Ajustes de facturación**, en el bloque **Facturación real y ajustes**. Los usuarios cuyo perfil sea Facturación o Gerencia pueden registrar y revertir ajustes. El servidor comprueba el perfil actual del usuario; Bodega, Vendedores, Producción y Jefatura de ventas no pueden escribir ajustes con estos endpoints.

**Registrar nota de crédito:** selecciona la factura afectada, indica el número y la fecha de la nota, su base sin IVA y su IVA por separado, explica el motivo y adjunta el PDF o imagen. Los importes deben copiarse del documento contable. La vista previa muestra el saldo resultante antes de guardar.

**Corregir valores registrados:** selecciona la factura e ingresa su base correcta y el IVA correcto, antes de notas de crédito. Para corregir un IVA mal registrado a cero, conserva la base de la factura y escribe 0 en IVA. Adjunta la factura o documento de respaldo e indica el motivo. No vuelvas a restar una nota de crédito en estos valores.

**Revertir registro:** disponible desde el historial. Requiere fecha y motivo. Revierte el efecto del registro en CandyTec y conserva tanto el registro como la reversión y sus archivos. No anula el documento del sistema contable. No se permiten reversiones repetidas o resultados con base/IVA negativos.

## Valores visibles

- Total original del pedido: precios, cantidades, descuento e IVA originales del sistema.
- Valor del pedido tras ajustes: total original + correcciones − notas de crédito, incluyendo la parte pendiente de facturar.
- Facturado original registrado: valor inicial registrado de las facturas.
- Correcciones de registro: diferencia entre los importes registrados inicialmente y los importes corregidos.
- Notas de crédito vigentes: notas que no se hayan revertido dentro de CandyTec.
- Facturación neta: facturación original + correcciones − notas de crédito.
- Pendiente por cobrar: facturación neta − abonos, con mínimo cero.
- Saldo a favor: exceso de abonos respecto de la facturación neta. No se devuelve ni aplica automáticamente a otros pedidos.

Ejemplo: factura 1.150, nota de crédito 115 y abonos 500: neto 1.035; pendiente 535. Si los abonos fueran 1.150, aparecerían 115 de saldo a favor.

En pedidos parcialmente facturados, el pendiente por cobrar se calcula sobre lo facturado, no sobre todo el pedido. Se corrige también el cálculo que aplicaba 15 % fijo en reportes: ahora utiliza el IVA del pedido o los valores corregidos de cada factura.

Las tarjetas de cobranza, agregados de facturación por pedido y exportación general incorporan los valores netos. La exportación conserva el total original y agrega correcciones, notas, total tras ajustes, facturación neta y saldo a favor. Los períodos de los informes conservan sus filtros y fechas anteriores; no constituyen un libro contable por fecha de emisión de cada nota. Los rankings por producto mantienen valores brutos, señalados como tales: una nota registrada por factura no se distribuye arbitrariamente entre productos.

## Historial y datos anteriores

La primera modificación conserva una referencia de base e IVA de la factura afectada. Para documentos antiguos, esa referencia se calcula con los datos que hoy existen en CandyTec; no reconstruye automáticamente el importe histórico de un documento externo. Si el valor no coincide, registra primero la corrección correspondiente y después la nota de crédito.

Adjuntar anteriormente una nota como archivo no descontaba su valor. Esos documentos no se convierten automáticamente en ajustes: sus importes deben registrarse y verificarse. El formulario de adjuntos aclara esta diferencia.

Los ajustes no alteran productos, cantidades, movimientos de inventario, entregas ni abonos. Las devoluciones físicas siguen registrándose por el flujo de inventario. Una factura con ajustes no permite alterar sus importes desde el antiguo editor del pedido; utiliza el módulo de ajustes para preservar la referencia.

Cada entrada registra usuario, perfil, fecha de registro, fecha documental, factura, número de documento, importes, motivo y respaldo. No hay borrado de entradas.

## Integridad y despliegue

La actualización agrega a pedidos una columna JSONB `financial_data`. No recalcula ni sobrescribe saldos persistidos de otros módulos durante la migración. Los saldos de cobranza se derivan al consultar usando facturas, ajustes y abonos.

Los registros se hacen dentro de una transacción, con bloqueo del pedido, comprobación de versión y clave de operación para reintentos. Se rechazan notas activas con el mismo número, incluso si están en otro pedido. Si una misma nota se necesita distribuir entre varios pedidos, esta versión requiere resolver esa asignación antes de registrarla; no cargarla repetidamente.

Archivos: server.js, frontend/index.html, lib/order-finance-core.js, lib/order-finance.js, tests/order-finance.test.js y esta guía. No hay nuevas dependencias de producción. El bloque de reglas compartidas se incorpora al HTML; la prueba de paridad exige actualizar ambas copias cuando cambie.

Validación: `node --test tests/*.test.js`. Se comprobaron 37 pruebas existentes y nuevas. Además, se probaron endpoints Express con PostgreSQL local mediante PGlite y formularios mediante DOM con datos ficticios: permisos, persistencia, duplicados, conflictos, rollback, IVA cero y reintentos. No se verificó el despliegue real en Render ni el equipo del usuario.
