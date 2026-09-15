# Planificador semanal arrastrable

Esta actualización convierte el planificador temporal en una matriz semanal similar a la hoja Excel usada por CandyTec.

## Uso

1. Elige la semana con las flechas, el botón **Hoy** o el campo de fecha.
2. Busca el pedido en **Pedidos pendientes**.
3. En computadora, arrástralo sobre el encabezado del día de despacho. En pantallas táctiles, utiliza **Agregar al día…**.
4. El sistema crea una fila para el cliente y coloca las cantidades en las columnas de sus productos.
5. Arrastra una fila ya programada hacia otro día para reprogramarla.
6. Pulsa **×** en el número de pedido para devolverlo a pendientes.
7. Si el pedido todavía está por facturar, las cantidades pueden ajustarse en sus celdas.

El inventario final de cada día se convierte automáticamente en el inventario inicial del siguiente. Los valores negativos señalan un faltante previsto.

## Alcance y seguridad

- El calendario es temporal: no crea ni guarda planes de despacho.
- No modifica el estado de los pedidos ni el inventario.
- **Borrar calendario** devuelve todos los pedidos a la bandeja pendiente.
- **Descargar Excel** y **Hoja de ruta / PDF** siguen revalidando los pedidos contra el servidor antes de generar el documento.
- Las columnas corresponden al catálogo actual y a cualquier producto presente en los pedidos programados.

## Verificación

```bash
node --check server.js
node --test tests/planner-core.test.js tests/planner-selection.test.js
```
