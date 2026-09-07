const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const port = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;

if (!jwtSecret || !databaseUrl) {
  console.error('Configure JWT_SECRET e DATABASE_URL nas variáveis de ambiente.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: isProduction ? { rejectUnauthorized: false } : false
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '20kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname)));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false
});

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function createToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email }, jwtSecret, { expiresIn: '7d' });
}

function setAuthCookie(res, token) {
  res.cookie('session', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies.session;
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });
    const payload = jwt.verify(token, jwtSecret);
    const result = await pool.query('SELECT id, name, email FROM users WHERE id = $1', [payload.sub]);
    if (!result.rowCount) return res.status(401).json({ error: 'Sessão inválida.' });
    req.user = result.rows[0];
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

app.post('/api/register', authLimiter, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');

    if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Informe um nome válido.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Informe um e-mail válido.' });
    if (password.length < 8 || password.length > 128) return res.status(400).json({ error: 'A senha deve ter entre 8 e 128 caracteres.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email',
      [name, email, passwordHash]
    );
    const user = result.rows[0];
    setAuthCookie(res, createToken(user));
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao criar a conta.' });
  }
});

app.post('/api/login', authLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const result = await pool.query('SELECT id, name, email, password_hash FROM users WHERE email = $1', [email]);
    if (!result.rowCount) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
    setAuthCookie(res, createToken(user));
    res.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno ao entrar.' });
  }
});

app.get('/api/me', requireAuth, (req, res) => res.json({ user: req.user }));

app.post('/api/logout', (req, res) => {
  res.clearCookie('session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

initDatabase()
  .then(() => app.listen(port, () => console.log(`Servidor ativo na porta ${port}`)))
  .catch((error) => {
    console.error('Falha ao iniciar banco:', error);
    process.exit(1);
  });
