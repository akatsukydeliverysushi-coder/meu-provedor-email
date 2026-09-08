const fs = require('fs');
const path = require('path');

// Captura o app Express criado pelo servidor principal sem precisar reescrever server.js.
const express = require('express');
const originalListen = express.application.listen;
let app;
express.application.listen = function (...args) {
  app = this;
  return originalListen.apply(this, args);
};

require('./server.js');

if (!app) {
  throw new Error('Não foi possível obter a aplicação Express de server.js.');
}

// Garante explicitamente que a raiz do domínio entregue o index.html atual.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rotas explícitas para as páginas principais do aplicativo.
for (const page of ['index.html', 'cadastro.html', 'dashboard.html']) {
  app.get(`/${page}`, (req, res) => {
    res.sendFile(path.join(__dirname, page));
  });
}

// Endpoint opcional para identificar exatamente a versão que está rodando no Railway.
app.get('/api/version', (req, res) => {
  res.json({
    app: 'VM',
    version: 'railway-main-2026-09-08',
    bootstrap: true
  });
});

// Integração opcional com OpenAI. Só fica disponível quando OPENAI_API_KEY estiver configurada.
const jwt = require('jsonwebtoken');

app.post('/api/ai/chat', async (req, res) => {
  try {
    const token = req.cookies?.token;
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });

    let user;
    try {
      user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ error: 'Sessão inválida.' });
    }

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'Integração GPT ainda não configurada.' });
    }

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Mensagem vazia.' });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-5-mini',
        input: `Usuário autenticado ${user.id}: ${message}`,
        store: false
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json({ error: data.error?.message || 'Erro na API da OpenAI.' });
    }

    const text = data.output_text || (data.output || [])
      .flatMap(item => item.content || [])
      .filter(item => item.type === 'output_text')
      .map(item => item.text)
      .join('\n');

    res.json({ reply: text || 'Não foi possível obter uma resposta.' });
  } catch (error) {
    console.error('Erro /api/ai/chat:', error);
    res.status(500).json({ error: 'Erro interno ao consultar o GPT.' });
  }
});

console.log('Integração GPT carregada: POST /api/ai/chat');
