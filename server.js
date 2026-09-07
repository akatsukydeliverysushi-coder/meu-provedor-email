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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      sender_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipient_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subject VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages (recipient_id, created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages (sender_id, created_at DESC)');
  await pool.query(`CREATE TABLE IF NOT EXISTS message_deletions (message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE, user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE, deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (message_id, user_id))`);
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
    const result = await pool.query('INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email', [name, email, passwordHash]);
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

app.post('/api/messages', requireAuth, async (req, res) => {
  try {
    const recipientEmail = normalizeEmail(req.body.recipient);
    const subject = String(req.body.subject || '').trim();
    const body = String(req.body.body || '').trim();
    if (!/^\S+@\S+\.\S+$/.test(recipientEmail)) return res.status(400).json({ error: 'Informe o e-mail do destinatário.' });
    if (!subject || subject.length > 200) return res.status(400).json({ error: 'O assunto é obrigatório e deve ter até 200 caracteres.' });
    if (!body || body.length > 20000) return res.status(400).json({ error: 'A mensagem é obrigatória e deve ter até 20.000 caracteres.' });
    const recipientResult = await pool.query('SELECT id, email FROM users WHERE email = $1', [recipientEmail]);
    if (!recipientResult.rowCount) return res.status(404).json({ error: 'Destinatário não encontrado neste provedor.' });
    const messageResult = await pool.query(
      'INSERT INTO messages (sender_id, recipient_id, subject, body) VALUES ($1, $2, $3, $4) RETURNING id, subject, body, created_at',
      [req.user.id, recipientResult.rows[0].id, subject, body]
    );
    res.status(201).json({ message: messageResult.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar a mensagem.' });
  }
});

function getSearch(req) {
  return String(req.query.q || '').trim().slice(0, 100);
}

app.get('/api/messages/trash', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.subject, m.body, m.is_read, m.created_at, d.deleted_at,
             su.name AS sender_name, su.email AS sender_email,
             ru.name AS recipient_name, ru.email AS recipient_email
      FROM message_deletions d
      JOIN messages m ON m.id = d.message_id
      JOIN users su ON su.id = m.sender_id
      JOIN users ru ON ru.id = m.recipient_id
      WHERE d.user_id = $1 ORDER BY d.deleted_at DESC LIMIT 100
    `, [req.user.id]);
    res.json({ messages: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar a lixeira.' });
  }
});

app.get('/api/messages/inbox', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.subject, m.body, m.is_read, m.created_at, u.name AS sender_name, u.email AS sender_email
      FROM messages m JOIN users u ON u.id = m.sender_id
      WHERE m.recipient_id = $1 AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = $1) AND ($2 = '' OR u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR m.subject ILIKE '%' || $2 || '%' OR m.body ILIKE '%' || $2 || '%') ORDER BY m.created_at DESC LIMIT 100
    `, [req.user.id, getSearch(req)]);
    res.json({ messages: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar a caixa de entrada.' });
  }
});

app.get('/api/messages/sent', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.id, m.subject, m.body, m.created_at, u.name AS recipient_name, u.email AS recipient_email
      FROM messages m JOIN users u ON u.id = m.recipient_id
      WHERE m.sender_id = $1 AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = $1) AND ($2 = '' OR u.name ILIKE '%' || $2 || '%' OR u.email ILIKE '%' || $2 || '%' OR m.subject ILIKE '%' || $2 || '%' OR m.body ILIKE '%' || $2 || '%') ORDER BY m.created_at DESC LIMIT 100
    `, [req.user.id, getSearch(req)]);
    res.json({ messages: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao carregar mensagens enviadas.' });
  }
});

app.get('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Mensagem inválida.' });
    const result = await pool.query(`
      SELECT m.id, m.subject, m.body, m.is_read, m.created_at,
             su.name AS sender_name, su.email AS sender_email,
             ru.name AS recipient_name, ru.email AS recipient_email
      FROM messages m
      JOIN users su ON su.id = m.sender_id
      JOIN users ru ON ru.id = m.recipient_id
      WHERE m.id = $1 AND (m.sender_id = $2 OR m.recipient_id = $2) AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = $2)
    `, [id, req.user.id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    const message = result.rows[0];
    if (String(req.user.id) === String(message.recipient_id)) {
      await pool.query('UPDATE messages SET is_read = TRUE WHERE id = $1 AND recipient_id = $2', [id, req.user.id]);
      message.is_read = true;
    }
    res.json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao abrir a mensagem.' });
  }
});

app.get('/api/messages/unread-count', requireAuth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM messages m WHERE m.recipient_id = $1 AND m.is_read = FALSE AND NOT EXISTS (SELECT 1 FROM message_deletions d WHERE d.message_id = m.id AND d.user_id = $1)`, [req.user.id]);
    res.json({ count: result.rows[0].count });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao contar mensagens.' });
  }
});

app.delete('/api/messages/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Mensagem inválida.' });
    const allowed = await pool.query('SELECT id FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)', [id, req.user.id]);
    if (!allowed.rowCount) return res.status(404).json({ error: 'Mensagem não encontrada.' });
    await pool.query('INSERT INTO message_deletions (message_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, req.user.id]);
    res.status(204).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao excluir a mensagem.' });
  }
});

app.post('/api/messages/:id/restore', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Mensagem inválida.' });
  await pool.query('DELETE FROM message_deletions WHERE message_id = $1 AND user_id = $2', [id, req.user.id]);
  res.status(204).end();
});

app.delete('/api/messages/:id/permanent', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Mensagem inválida.' });
  await pool.query('DELETE FROM message_deletions WHERE message_id = $1 AND user_id = $2', [id, req.user.id]);
  const check = await pool.query('SELECT id FROM messages WHERE id = $1 AND (sender_id = $2 OR recipient_id = $2)', [id, req.user.id]);
  if (check.rowCount) {
    await pool.query('INSERT INTO message_deletions (message_id, user_id) VALUES ($1, $2)', [id, req.user.id]);
  }
  res.status(204).end();
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('session', { httpOnly: true, secure: isProduction, sameSite: 'lax', path: '/' });
  res.status(204).end();
});

initDatabase().then(() => app.listen(port, () => console.log(`Servidor ativo na porta ${port}`))).catch((error) => {
  console.error('Falha ao iniciar banco:', error);
  process.exit(1);
});