const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

dotenv.config();

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
const generateToken = (userId, role) => {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET || 'dev-secret-key', { expiresIn: '7d' });
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
        creado_por VARCHAR(255),
        objetivo DECIMAL(12,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      );

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
        vendedor VARCHAR(255),
        estado VARCHAR(50),
        subtotal DECIMAL(12,2),
        descuento DECIMAL(12,2),
        descuento_motivo TEXT,
        cobrado DECIMAL(12,2),
        por_cobrar DECIMAL(12,2),
        recibio_nombre VARCHAR(255),
        history JSONB,
        attach JSONB,
        products JSONB,
        pago JSONB,
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

    const token = generateToken(user.id, user.role);
    res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
    const { nombre, ruc, correo, telefono, provincia, ciudad, direccion, creado_por } = req.body;
    const result = await pool.query(
      'INSERT INTO clientes (nombre, ruc, correo, telefono, provincia, ciudad, direccion, creado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
      [nombre, ruc, correo, telefono, provincia, ciudad, direccion, creado_por]
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
      objetivo: b.objetivo !== undefined ? b.objetivo : row.objetivo,
    };
    const result = await pool.query(
      `UPDATE clientes SET nombre=$1, ruc=$2, correo=$3, telefono=$4, provincia=$5, ciudad=$6, direccion=$7, objetivo=$8 WHERE id=$9 RETURNING *`,
      [merged.nombre, merged.ruc, merged.correo, merged.telefono, merged.provincia, merged.ciudad, merged.direccion, merged.objetivo, req.params.id]
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
    const { numero_pedido, cliente, ruc, producto, descripcion, cantidad, fecha_orden, fecha_entrega, fecha_cobro, forma_pago, ciudad, provincia, vendedor, estado, products, descuento, descuento_motivo, attach, history, subtotal } = req.body;
    const hist = history && history.length ? history : [{ s: estado, actor: `${vendedor} · Vendedor`, t: new Date().toISOString(), note: 'Pedido creado.' }];
    const result = await pool.query(
      `INSERT INTO pedidos (numero_pedido, cliente, ruc, producto, descripcion, cantidad, fecha_orden, fecha_entrega, fecha_cobro, forma_pago, ciudad, provincia, vendedor, estado, products, history, descuento, descuento_motivo, attach, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING *`,
      [numero_pedido, cliente, ruc, producto, descripcion, cantidad, fecha_orden || null, fecha_entrega || null, fecha_cobro || null, forma_pago, ciudad, provincia, vendedor, estado,
       JSON.stringify(products || []), JSON.stringify(hist), descuento || 0, descuento_motivo || '', JSON.stringify(attach || []), subtotal || null]
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
      subtotal: b.subtotal !== undefined ? b.subtotal : row.subtotal,
      descuento: b.descuento !== undefined ? b.descuento : row.descuento,
      descuento_motivo: b.descuento_motivo !== undefined ? b.descuento_motivo : row.descuento_motivo,
      recibio_nombre: b.recibio_nombre !== undefined ? b.recibio_nombre : row.recibio_nombre,
      pago: b.pago !== undefined ? JSON.stringify(b.pago) : row.pago,
      history: b.history !== undefined ? JSON.stringify(b.history) : row.history,
      attach: b.attach !== undefined ? JSON.stringify(b.attach) : row.attach,
      products: b.products !== undefined ? JSON.stringify(b.products) : row.products,
    };

    const result = await pool.query(
      `UPDATE pedidos SET factura=$1, estado=$2, fecha_cobro=$3, subtotal=$4, descuento=$5,
       descuento_motivo=$6, recibio_nombre=$7, pago=$8, history=$9, attach=$10, products=$11
       WHERE numero_pedido=$12 RETURNING *`,
      [merged.factura, merged.estado, merged.fecha_cobro, merged.subtotal, merged.descuento,
       merged.descuento_motivo, merged.recibio_nombre, merged.pago, merged.history, merged.attach,
       merged.products, req.params.id]
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
    const { estado, recibido_por, recibido_fecha } = req.body;
    const result = await pool.query(
      'UPDATE producciones SET estado = $1, recibido_por = $2, recibido_fecha = $3 WHERE id = $4 RETURNING *',
      [estado, recibido_por, recibido_fecha, req.params.id]
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
