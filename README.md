# CandyTec Backend

Backend Node.js + Express + PostgreSQL para el sistema de gestión de CandyTec.

## Instalación local

### Requisitos previos
- Node.js v18+
- npm
- PostgreSQL (local) O Render.com (cloud)

### Paso 1: Clonar el repositorio

```bash
git clone https://github.com/sergioespinosach-code/candytec-backend.git
cd candytec-backend
```

### Paso 2: Instalar dependencias

```bash
npm install
```

### Paso 3: Configurar .env

Crea un archivo `.env` en la raíz del proyecto con:

```
PORT=3000
DATABASE_URL=postgresql://user:password@localhost:5432/candytec
JWT_SECRET=tu-secreto-super-seguro
NODE_ENV=development
```

**Para PostgreSQL local:** 
- User: `postgres` (o el usuario que creaste)
- Password: tu contraseña
- Database: `candytec` (crear primero con `createdb candytec`)

**Para Render.com:**
- Render creará automáticamente una DATABASE_URL

### Paso 4: Iniciar el servidor

```bash
npm start
```

Debe salirte:
```
✓ Base de datos inicializada
✓ Servidor corriendo en puerto 3000
```

### Paso 5: Probar

```bash
curl http://localhost:3000/health
```

Debe retornar: `{"status":"ok","timestamp":"..."}`

---

## Crear los usuarios reales (una sola vez)

El sistema NO trae usuarios ni datos de ejemplo por defecto. Para crear los 13 usuarios reales del equipo (sin ningún cliente, pedido o dato de prueba):

1. En Render → tu servicio `candytec-backend` → pestaña **Shell**
2. Ejecuta:
   ```
   npm run seed
   ```

Esto crea únicamente las cuentas de login. Contraseña temporal para todos: **`CandyTec2026!`** — cada persona debe cambiarla en su primer ingreso.

| Username | Nombre | Rol |
|----------|--------|-----|
| v_bayron | Bayron Pesantez | vendedor |
| v_luisb | Luis Barragán | vendedor |
| v_johnny | Johnny Hernández | vendedor |
| v_diego | Diego Pilatuña | vendedor |
| v_lidia | Lidia Santos | vendedor |
| v_mayra | Mayra Pérez | vendedor |
| v_lizeth | Lizeth Salazar | vendedor |
| jventas | Cristian Pilatuña | jefe de ventas |
| facturacion | Nathalia Cabrera | facturación |
| bodega | Erika Usiña | bodega |
| jefe | Jefe de Producción | jefe de producción |
| gerente_proy | Sergio Andrés Espinosa | gerente |
| gerente | Sergio Espinosa | gerente |

## Borrar todos los datos y volver a empezar de cero

Cuando quieras reiniciar las pruebas (borrar todos los clientes, pedidos, producción, movimientos, solicitudes e inventario cargados):

1. En Render → tu servicio `candytec-backend` → pestaña **Shell**
2. Ejecuta:
   ```
   npm run reset
   ```

Esto borra **todo lo operativo** pero **no toca los usuarios** — nadie pierde su acceso, solo se vacían los datos de negocio. Es seguro correrlo las veces que quieras mientras estás probando.

⚠️ Es irreversible: una vez corrido, esos datos no se recuperan.

---

## API Endpoints

### Autenticación

**POST /api/auth/login**
```json
{ "username": "gerente", "password": "pass123" }
```

Retorna: `{ "token": "...", "user": {...} }`

---

### Clientes

- `GET /api/clientes` — Lista todos
- `POST /api/clientes` — Crear
- `DELETE /api/clientes/:id` — Eliminar

---

### Pedidos

- `GET /api/pedidos` — Lista todos
- `POST /api/pedidos` — Crear
- `PUT /api/pedidos/:id` — Actualizar estado/factura

---

### Producciones

- `GET /api/producciones` — Lista registros
- `POST /api/producciones` — Registrar producción

---

### Movimientos, Solicitudes, Inventario

Igual patrón: `GET`, `POST`, `PUT`

---

## Deploy a Render.com

1. Push a GitHub: `git push origin main`
2. En Render.com: conecta este repo
3. Render auto-detecta Node.js, instala dependencias y levanta el servidor
4. BD PostgreSQL se crea automáticamente

---

## Estructura del código

```
candytec-backend/
├── server.js           # Servidor Express + rutas API
├── .env                # Variables de entorno
├── .gitignore          # Archivos a ignorar en Git
├── package.json        # Dependencias
└── README.md           # Este archivo
```

---

## Notas

- Todos los endpoints requieren header `Authorization: Bearer <token>`
- Los datos se persisten en PostgreSQL
- La BD se inicializa automáticamente al arrancar el servidor
