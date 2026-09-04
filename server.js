const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cloudinary = require('cloudinary').v2;

// Cloudinary se autoconfigura solo leyendo la variable de entorno CLOUDINARY_URL
// (no hace falta llamar a cloudinary.config() a mano — el SDK la detecta sola)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }); // máx 10MB

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Conexión a PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('render.com') ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Pool error:', err);
});

// ============================================================
// UTILIDADES
// ============================================================
const generateToken = (userId, username, name, role) => {
  return jwt.sign({ userId, username, name, role }, process.env.JWT_SECRET || 'dev-secret-key', { expiresIn: '7d' });
};

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dev-secret-key');
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// Solo el usuario 'gerente_proy' (Sergio Andrés Espinosa) puede administrar el sistema
const requireSuperAdmin = (req, res, next) => {
  if (req.user?.username !== 'gerente_proy') return res.status(403).json({ error: 'No autorizado' });
  next();
};

// ============================================================
// INICIALIZAR BASE DE DATOS
// ============================================================
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        role VARCHAR(50),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS clientes (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) NOT NULL,
        ruc VARCHAR(50) UNIQUE NOT NULL,
        correo VARCHAR(255),
        telefono VARCHAR(20),
        provincia VARCHAR(100),
        ciudad VARCHAR(100),
        direccion TEXT,
        sector VARCHAR(150),
        creado_por VARCHAR(255),
        objetivo DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE SEQUENCE IF NOT EXISTS pedido_numero_seq START 1051;

      CREATE TABLE IF NOT EXISTS pedidos (
        id SERIAL PRIMARY KEY,
        numero_pedido VARCHAR(50) UNIQUE NOT NULL,
        factura VARCHAR(50),
        cliente VARCHAR(255),
        ruc VARCHAR(50),
        producto TEXT,
        descripcion TEXT,
        cantidad VARCHAR(50),
        fecha_orden DATE,
        fecha_entrega DATE,
        fecha_cobro DATE,
        forma_pago VARCHAR(100),
        ciudad VARCHAR(100),
        provincia VARCHAR(100),
        direccion_entrega TEXT,
        vendedor VARCHAR(255),
        estado VARCHAR(50),
        subtotal DECIMAL(12,2),
        descuento DECIMAL(12,2),
        descuento_motivo TEXT,
        iva_tasa DECIMAL(5,2) DEFAULT 15,
        costo_transporte DECIMAL(12,2),
        costo_estibaje DECIMAL(12,2),
        cobrado DECIMAL(12,2),
        por_cobrar DECIMAL(12,2),
        recibio_nombre VARCHAR(255),
        history JSONB,
        attach JSONB,
        products JSONB,
        pago JSONB,
        entregas JSONB DEFAULT '[]',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS producciones (
        id SERIAL PRIMARY KEY,
        fecha DATE,
        lote VARCHAR(100),
        items JSONB,
        estado VARCHAR(50),
        registrado_por VARCHAR(255),
        recibido_por VARCHAR(255),
        recibido_fecha TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS movimientos (
        id SERIAL PRIMARY KEY,
        item_id INTEGER,
        tipo VARCHAR(50),
        cantidad DECIMAL(10,2),
        motivo TEXT,
        usuario VARCHAR(255),
        fecha TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS solicitudes (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        ref_id VARCHAR(50),
        ref_nombre VARCHAR(255),
        campo VARCHAR(255),
        valor_nuevo TEXT,
        motivo TEXT,
        solicitante VARCHAR(255),
        fecha TIMESTAMP,
        estado VARCHAR(50),
        resuelto_por VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS inventario (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50),
        nombre VARCHAR(255),
        unidad VARCHAR(50),
        stock DECIMAL(10,2),
        minimo DECIMAL(10,2),
        costo_prom DECIMAL(10,2),
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(tipo, nombre)
      );

      CREATE TABLE IF NOT EXISTS catalogo (
        id SERIAL PRIMARY KEY,
        nombre VARCHAR(255) UNIQUE NOT NULL,
        peso_bulto DECIMAL(10,3),
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Migración: agregar restricción única si la tabla inventario ya existía sin ella
    try {
      await pool.query(`ALTER TABLE inventario ADD CONSTRAINT inventario_tipo_nombre_key UNIQUE (tipo, nombre);`);
    } catch (migErr3) {
      console.log('Migración UNIQUE inventario: sin cambios necesarios (ya existía o hay duplicados previos)');
    }
    // Migración: si la tabla solicitudes ya existía con ref_id como INTEGER
    // (de un deploy anterior), la ajustamos a VARCHAR para admitir pedidos (texto).
    try {
      await pool.query(`ALTER TABLE solicitudes ALTER COLUMN ref_id TYPE VARCHAR(50) USING ref_id::text;`);
    } catch (migErr) {
      console.log('Migración ref_id: sin cambios necesarios');
    }

    // Migración: agregar columna valor_nuevo si la tabla solicitudes ya existía sin ella
    try {
      await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS valor_nuevo TEXT;`);
    } catch (migErr2) {
      console.log('Migración valor_nuevo: sin cambios necesarios');
    }

    // Migración: agregar columna objetivo si la tabla clientes ya existía sin ella
    try {
      await pool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS objetivo DECIMAL(12,2) DEFAULT 0;`);
    } catch (migErr4) {
      console.log('Migración objetivo: sin cambios necesarios');
    }

    // Migración: agregar columna entregas (entregas parciales) si la tabla pedidos ya existía sin ella
    try {
      await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS entregas JSONB DEFAULT '[]';`);
    } catch (migErr8) {
      console.log('Migración entregas: sin cambios necesarios');
    }

    // Migración: agregar peso_bulto al catálogo (para el reporte de producción y logística)
    try {
      await pool.query(`ALTER TABLE catalogo ADD COLUMN IF NOT EXISTS peso_bulto DECIMAL(10,3);`);
    } catch (migErr9) {
      console.log('Migración peso_bulto: sin cambios necesarios');
    }

    // Migración: agregar sector a clientes (para el reporte de producción y logística)
    try {
      await pool.query(`ALTER TABLE clientes ADD COLUMN IF NOT EXISTS sector VARCHAR(150);`);
    } catch (migErr10) {
      console.log('Migración sector: sin cambios necesarios');
    }

    // Migración: agregar direccion_entrega a pedidos (se perdía y nunca se guardaba)
    try {
      await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS direccion_entrega TEXT;`);
    } catch (migErr11) {
      console.log('Migración direccion_entrega: sin cambios necesarios');
    }

    // Migración: agregar iva_tasa a pedidos (por defecto 15%, con opción de 0%)
    try {
      await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS iva_tasa DECIMAL(5,2) DEFAULT 15;`);
      await pool.query(`UPDATE pedidos SET iva_tasa=15 WHERE iva_tasa IS NULL;`);
    } catch (migErr12) {
      console.log('Migración iva_tasa: sin cambios necesarios');
    }

    // Migración: agregar costo_transporte y costo_estibaje (para pedidos "de una sola entrega" antiguos,
    // que no pasan por el arreglo entregas y necesitan su propio lugar para guardar el costo logístico)
    try {
      await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS costo_transporte DECIMAL(12,2);`);
      await pool.query(`ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS costo_estibaje DECIMAL(12,2);`);
    } catch (migErr13) {
      console.log('Migración costo_transporte/costo_estibaje: sin cambios necesarios');
    }

    // Sembrar el catálogo de productos inicial, solo si la tabla está vacía
    try {
      const count = await pool.query('SELECT COUNT(*) FROM catalogo');
      if (parseInt(count.rows[0].count) === 0) {
        const productosIniciales = [
          'YumYum Caramelo duro 5Kg.', 'YumYum Caramelo duro 10Kg.',
          'YumYum DobleTwist duro 5Kg.', 'YumYum DobleTwist duro 10Kg.',
          'Cream Toffy Caja x 10Kg.', 'Toffee Bocado Caja x 10Kg.',
          'Toffee Navideño Caja x 10Kg.', 'Paleta Acidazo con polvo Caja',
          'Paleta Acidazo con polvo fundón x 150u.', 'Chupete Chispipop navideño fundón x 200u.',
        ];
        for (const nombre of productosIniciales) {
          await pool.query('INSERT INTO catalogo (nombre) VALUES ($1) ON CONFLICT (nombre) DO NOTHING', [nombre]);
        }
        console.log('✓ Catálogo inicial sembrado con', productosIniciales.length, 'productos');
      }
    } catch (migErr5) {
      console.log('Siembra de catálogo: sin cambios necesarios');
    }

    // Asegurar que cada producto del catálogo tenga su ítem en Bodega P. Terminado (stock 0 si aún no existe)
    try {
      const catalogo = await pool.query('SELECT nombre FROM catalogo');
      for (const row of catalogo.rows) {
        await pool.query(
          `INSERT INTO inventario (tipo, nombre, unidad, stock, minimo) VALUES ('producto_terminado', $1, 'unidades', 0, 0)
           ON CONFLICT (tipo, nombre) DO NOTHING`,
          [row.nombre]
        );
      }
    } catch (migErr6) {
      console.log('Sincronización catálogo→inventario: sin cambios necesarios');
    }

    // Seguridad: adelantar la secuencia de números de pedido por encima de cualquier
    // número que ya exista (de pedidos creados antes de este arreglo), para no repetir ninguno
    try {
      const maxRes = await pool.query(
        `SELECT MAX(CAST(SUBSTRING(numero_pedido FROM 'CT-2026-0(\\d+)$') AS INTEGER)) as maxn FROM pedidos WHERE numero_pedido ~ 'CT-2026-0\\d+$'`
      );
      const maxn = maxRes.rows[0].maxn;
      if (maxn) {
        await pool.query(`SELECT setval('pedido_numero_seq', GREATEST($1, (SELECT last_value FROM pedido_numero_seq)))`, [maxn + 1]);
        console.log('✓ Secuencia de número de pedido adelantada por encima de', maxn);
      }
    } catch (migErr7) {
      console.log('Ajuste de secuencia de pedidos: sin cambios necesarios');
    }

    console.log('✓ Base de datos inicializada');
  } catch (err) {
    console.error('DB init error:', err);
  }
}

// ============================================================
// RUTAS: AUTENTICACIÓN
// ============================================================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Usuario no encontrado' });
    }

    const user = result.rows[0];
    const isValid = await bcrypt.compare(password, user.password);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = generateToken(user.id, user.username, user.name, user.role);
    res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', verifyToken, (req, res) => {
  res.json({ username: req.user.username, name: req.user.name, role: req.user.role });
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { username, password, name, role } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const result = await pool.query(
      'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role',
      [username, hashedPassword, name, role]
    );
    
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: CATÁLOGO DE PRODUCTOS
// ============================================================
app.get('/api/catalogo', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM catalogo ORDER BY nombre ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/catalogo', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { nombre, peso_bulto } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre no puede estar vacío' });
    const result = await pool.query('INSERT INTO catalogo (nombre, peso_bulto) VALUES ($1, $2) RETURNING *', [nombre.trim(), peso_bulto || null]);
    await pool.query(
      `INSERT INTO inventario (tipo, nombre, unidad, stock, minimo) VALUES ('producto_terminado', $1, 'unidades', 0, 0)
       ON CONFLICT (tipo, nombre) DO NOTHING`,
      [nombre.trim()]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ese producto ya existe en el catálogo' });
    res.status(500).json({ error: err.message });
  }
});
app.put('/api/catalogo/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { peso_bulto } = req.body;
    const result = await pool.query('UPDATE catalogo SET peso_bulto=$1 WHERE id=$2 RETURNING *', [peso_bulto, req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Producto no encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/catalogo/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM catalogo WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: ADMINISTRACIÓN (solo gerente_proy — Sergio Andrés Espinosa)
// ============================================================
app.get('/api/admin/users', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, name, role, created_at FROM users ORDER BY id ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { username, name, role, password } = req.body;
    if (!username || !name || !role || !password) return res.status(400).json({ error: 'Faltan campos obligatorios' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4) RETURNING id, username, name, role',
      [username.trim(), hashed, name.trim(), role]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(400).json({ error: 'Ese usuario ya existe' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/users/:id/password', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    const hashed = await bcrypt.hash(password, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Autocambio de contraseña: cualquier usuario logueado puede cambiar la SUYA, verificando la actual
app.put('/api/auth/me/password', verifyToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Faltan campos' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 6 caracteres' });
    const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.userId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    const match = await bcrypt.compare(currentPassword, result.rows[0].password);
    if (!match) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.user.userId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/admin/users/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const target = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
    if (!target.rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (target.rows[0].username === 'gerente_proy') {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de administración' });
    }
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/reset-data', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    const tablas = ['pedidos', 'clientes', 'producciones', 'movimientos', 'solicitudes', 'inventario'];
    for (const t of tablas) {
      await pool.query(`TRUNCATE TABLE ${t} RESTART IDENTITY CASCADE`);
    }
    // el catálogo no se borra, pero sus ítems de inventario sí (por diseño) — los recreamos en cero
    const catalogo = await pool.query('SELECT nombre FROM catalogo');
    for (const row of catalogo.rows) {
      await pool.query(
        `INSERT INTO inventario (tipo, nombre, unidad, stock, minimo) VALUES ('producto_terminado', $1, 'unidades', 0, 0)
         ON CONFLICT (tipo, nombre) DO NOTHING`,
        [row.nombre]
      );
    }
    res.json({ success: true, tablas });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: CLIENTES
// ============================================================
app.get('/api/clientes', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clientes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clientes', verifyToken, async (req, res) => {
  try {
    const { nombre, ruc, correo, telefono, provincia, ciudad, direccion, sector, creado_por } = req.body;
    const result = await pool.query(
      'INSERT INTO clientes (nombre, ruc, correo, telefono, provincia, ciudad, direccion, sector, creado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [nombre, ruc, correo, telefono, provincia, ciudad, direccion, sector || null, creado_por]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/clientes/:id', verifyToken, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM clientes WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Cliente no encontrado' });
    const row = current.rows[0];
    const b = req.body;
    const merged = {
      nombre: b.nombre !== undefined ? b.nombre : row.nombre,
      ruc: b.ruc !== undefined ? b.ruc : row.ruc,
      correo: b.correo !== undefined ? b.correo : row.correo,
      telefono: b.telefono !== undefined ? b.telefono : row.telefono,
      provincia: b.provincia !== undefined ? b.provincia : row.provincia,
      ciudad: b.ciudad !== undefined ? b.ciudad : row.ciudad,
      direccion: b.direccion !== undefined ? b.direccion : row.direccion,
      sector: b.sector !== undefined ? b.sector : row.sector,
      objetivo: b.objetivo !== undefined ? b.objetivo : row.objetivo,
    };
    const result = await pool.query(
      `UPDATE clientes SET nombre=$1, ruc=$2, correo=$3, telefono=$4, provincia=$5, ciudad=$6, direccion=$7, objetivo=$8, sector=$9 WHERE id=$10 RETURNING *`,
      [merged.nombre, merged.ruc, merged.correo, merged.telefono, merged.provincia, merged.ciudad, merged.direccion, merged.objetivo, merged.sector, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/clientes/:id', verifyToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM clientes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pedidos/:id', verifyToken, requireSuperAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM pedidos WHERE numero_pedido = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: PEDIDOS
// ============================================================
app.get('/api/pedidos', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM pedidos ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pedidos', verifyToken, async (req, res) => {
  try {
    const { cliente, ruc, producto, descripcion, cantidad, fecha_orden, fecha_entrega, fecha_cobro, forma_pago, ciudad, provincia, direccion_entrega, vendedor, estado, products, descuento, descuento_motivo, attach, history, subtotal, iva_tasa } = req.body;
    // el número de pedido lo genera el servidor con una secuencia real — nunca se repite, ni si se borran pedidos
    const seq = await pool.query("SELECT nextval('pedido_numero_seq') as n");
    const numero_pedido = 'CT-2026-0' + seq.rows[0].n;
    const hist = history && history.length ? history : [{ s: estado, actor: `${vendedor} · Vendedor`, t: new Date().toISOString(), note: 'Pedido creado.' }];
    const result = await pool.query(
      `INSERT INTO pedidos (numero_pedido, cliente, ruc, producto, descripcion, cantidad, fecha_orden, fecha_entrega, fecha_cobro, forma_pago, ciudad, provincia, direccion_entrega, vendedor, estado, products, history, descuento, descuento_motivo, attach, subtotal, iva_tasa)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22) RETURNING *`,
      [numero_pedido, cliente, ruc, producto, descripcion, cantidad, fecha_orden || null, fecha_entrega || null, fecha_cobro || null, forma_pago, ciudad, provincia, direccion_entrega || '', vendedor, estado,
       JSON.stringify(products || []), JSON.stringify(hist), descuento || 0, descuento_motivo || '', JSON.stringify(attach || []), subtotal || null, iva_tasa!=null?iva_tasa:15]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pedidos/:id', verifyToken, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM pedidos WHERE numero_pedido = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Pedido no encontrado' });
    const row = current.rows[0];
    const b = req.body;

    const merged = {
      factura: b.factura !== undefined ? b.factura : row.factura,
      estado: b.estado !== undefined ? b.estado : row.estado,
      fecha_cobro: b.fecha_cobro !== undefined ? b.fecha_cobro : row.fecha_cobro,
      fecha_entrega: b.fecha_entrega !== undefined ? b.fecha_entrega : row.fecha_entrega,
      direccion_entrega: b.direccion_entrega !== undefined ? b.direccion_entrega : row.direccion_entrega,
      subtotal: b.subtotal !== undefined ? b.subtotal : row.subtotal,
      descuento: b.descuento !== undefined ? b.descuento : row.descuento,
      descuento_motivo: b.descuento_motivo !== undefined ? b.descuento_motivo : row.descuento_motivo,
      iva_tasa: b.iva_tasa !== undefined ? b.iva_tasa : row.iva_tasa,
      costo_transporte: b.costo_transporte !== undefined ? b.costo_transporte : row.costo_transporte,
      costo_estibaje: b.costo_estibaje !== undefined ? b.costo_estibaje : row.costo_estibaje,
      recibio_nombre: b.recibio_nombre !== undefined ? b.recibio_nombre : row.recibio_nombre,
      pago: JSON.stringify(b.pago !== undefined ? b.pago : row.pago),
      history: JSON.stringify(b.history !== undefined ? b.history : row.history),
      attach: JSON.stringify(b.attach !== undefined ? b.attach : row.attach),
      products: JSON.stringify(b.products !== undefined ? b.products : row.products),
      entregas: JSON.stringify(b.entregas !== undefined ? b.entregas : (row.entregas || [])),
    };

    const result = await pool.query(
      `UPDATE pedidos SET factura=$1, estado=$2, fecha_cobro=$3, subtotal=$4, descuento=$5,
       descuento_motivo=$6, recibio_nombre=$7, pago=$8, history=$9, attach=$10, products=$11, fecha_entrega=$12, entregas=$13, direccion_entrega=$14, iva_tasa=$15, costo_transporte=$16, costo_estibaje=$17
       WHERE numero_pedido=$18 RETURNING *`,
      [merged.factura, merged.estado, merged.fecha_cobro, merged.subtotal, merged.descuento,
       merged.descuento_motivo, merged.recibio_nombre, merged.pago, merged.history, merged.attach,
       merged.products, merged.fecha_entrega, merged.entregas, merged.direccion_entrega, merged.iva_tasa, merged.costo_transporte, merged.costo_estibaje, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: PRODUCCIONES
// ============================================================
app.get('/api/producciones', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM producciones ORDER BY fecha DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/producciones', verifyToken, async (req, res) => {
  try {
    const { fecha, lote, items, estado, registrado_por } = req.body;
    const result = await pool.query(
      'INSERT INTO producciones (fecha, lote, items, estado, registrado_por) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [fecha, lote, JSON.stringify(items), estado, registrado_por]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/producciones/:id', verifyToken, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM producciones WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Producción no encontrada' });
    const row = current.rows[0];
    const b = req.body;
    const merged = {
      fecha: b.fecha !== undefined ? b.fecha : row.fecha,
      lote: b.lote !== undefined ? b.lote : row.lote,
      items: JSON.stringify(b.items !== undefined ? b.items : row.items),
      estado: b.estado !== undefined ? b.estado : row.estado,
      recibido_por: b.recibido_por !== undefined ? b.recibido_por : row.recibido_por,
      recibido_fecha: b.recibido_fecha !== undefined ? b.recibido_fecha : row.recibido_fecha,
    };
    const result = await pool.query(
      'UPDATE producciones SET fecha=$1, lote=$2, items=$3, estado=$4, recibido_por=$5, recibido_fecha=$6 WHERE id=$7 RETURNING *',
      [merged.fecha, merged.lote, merged.items, merged.estado, merged.recibido_por, merged.recibido_fecha, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: MOVIMIENTOS
// ============================================================
app.get('/api/movimientos', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM movimientos ORDER BY fecha DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/movimientos', verifyToken, async (req, res) => {
  try {
    const { item_id, tipo, cantidad, motivo, usuario, fecha } = req.body;
    const result = await pool.query(
      'INSERT INTO movimientos (item_id, tipo, cantidad, motivo, usuario, fecha) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [item_id, tipo, cantidad, motivo, usuario, fecha]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/movimientos/:id', verifyToken, async (req, res) => {
  try {
    const current = await pool.query('SELECT * FROM movimientos WHERE id = $1', [req.params.id]);
    if (!current.rows.length) return res.status(404).json({ error: 'Movimiento no encontrado' });
    const row = current.rows[0];
    const b = req.body;
    const merged = {
      tipo: b.tipo !== undefined ? b.tipo : row.tipo,
      cantidad: b.cantidad !== undefined ? b.cantidad : row.cantidad,
      motivo: b.motivo !== undefined ? b.motivo : row.motivo,
    };
    const result = await pool.query(
      'UPDATE movimientos SET tipo=$1, cantidad=$2, motivo=$3 WHERE id=$4 RETURNING *',
      [merged.tipo, merged.cantidad, merged.motivo, req.params.id]
    );
    res.json({ anterior: row, actual: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: SOLICITUDES
// ============================================================
app.get('/api/solicitudes', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM solicitudes ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/solicitudes', verifyToken, async (req, res) => {
  try {
    const { tipo, ref_id, ref_nombre, campo, valor_nuevo, motivo, solicitante } = req.body;
    const result = await pool.query(
      'INSERT INTO solicitudes (tipo, ref_id, ref_nombre, campo, valor_nuevo, motivo, solicitante, fecha, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *',
      [tipo, ref_id, ref_nombre, campo, valor_nuevo || null, motivo, solicitante, new Date(), 'PENDIENTE']
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/solicitudes/:id', verifyToken, async (req, res) => {
  try {
    const { estado, resuelto_por } = req.body;
    const result = await pool.query(
      'UPDATE solicitudes SET estado = $1, resuelto_por = $2 WHERE id = $3 RETURNING *',
      [estado, resuelto_por, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: INVENTARIO
// ============================================================
app.get('/api/inventario', verifyToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM inventario');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventario', verifyToken, async (req, res) => {
  try {
    const { tipo, nombre, unidad, stock, minimo, costo_prom } = req.body;
    const result = await pool.query(
      'INSERT INTO inventario (tipo, nombre, unidad, stock, minimo, costo_prom) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [tipo, nombre, unidad, stock, minimo, costo_prom]
    );
    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      // ya existe un ítem con ese tipo+nombre (evita duplicados por doble clic o carreras)
      const existing = await pool.query('SELECT * FROM inventario WHERE tipo=$1 AND nombre=$2', [req.body.tipo, req.body.nombre]);
      return res.json(existing.rows[0]);
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inventario/:id', verifyToken, async (req, res) => {
  try {
    const { stock, costo_prom } = req.body;
    const result = await pool.query(
      'UPDATE inventario SET stock = $1, costo_prom = COALESCE($2, costo_prom) WHERE id = $3 RETURNING *',
      [stock, costo_prom, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// RUTAS: SUBIDA DE ARCHIVOS (facturas PDF, fotos de entrega, comprobantes)
// ============================================================
app.post('/api/upload', verifyToken, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
  try {
    const uploaded = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'auto', folder: 'candytec' },
        (err, result) => (err ? reject(err) : resolve(result))
      );
      stream.end(req.file.buffer);
    });
    res.json({ url: uploaded.secure_url, name: req.file.originalname });
  } catch (err) {
    console.error('Upload error:', err);
    res.status(500).json({ error: 'No se pudo subir el archivo: ' + err.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// ============================================================
// INICIAR SERVIDOR
// ============================================================
(async () => {
  await initDB();
  app.listen(PORT, () => {
    console.log(`✓ Servidor corriendo en puerto ${PORT}`);
  });
})();

module.exports = app;
