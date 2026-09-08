const express = require('express');
const jwt = require('jsonwebtoken');

// Captura a instância Express criada pelo server.js sem precisar alterar o backend existente.
const originalExpress = express;
let application = null;

function expressWrapper(...args) {
  application = originalExpress(...args);
  return application;
}
Object.assign(expressWrapper, originalExpress);
require.cache[require.resolve('express')].exports = expressWrapper;

require('./server.js');

if (!application) {
  throw new Error('Não foi possível localizar a aplicação Express.');
}

const jwtSecret = process.env.JWT_SECRET;
const openaiKey = process.env.OPENAI_API_KEY;

application.post('/api/ai/chat', async (req, res) => {
  try {
    if (!jwtSecret) return res.status(500).json({ error: 'JWT_SECRET não configurado.' });
    if (!openaiKey) return res.status(503).json({ error: 'OPENAI_API_KEY não configurada no Railway.' });

    const token = req.headers.cookie
      ?.split(';')
      .map(v => v.trim())
      .find(v => v.startsWith('session='))
      ?.slice('session='.length);

    if (!token) return res.status(401).json({ error: 'Não autenticado.' });
    try {
      jwt.verify(decodeURIComponent(token), jwtSecret);
    } catch {
      return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
    }

    const message = String(req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Digite uma mensagem para o GPT.' });
    if (message.length > 12000) return res.status(400).json({ error: 'Mensagem muito longa.' });

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-5.6-luna',
        store: false,
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: message }]
          }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('OpenAI API:', data);
      return res.status(502).json({ error: data?.error?.message || 'Erro ao consultar o GPT.' });
    }

    res.json({
      answer: data.output_text || 'Não consegui gerar uma resposta.',
      responseId: data.id || null
    });
  } catch (error) {
    console.error('Erro no GPT:', error);
    res.status(500).json({ error: 'Erro interno ao consultar o GPT.' });
  }
});

console.log('Integração GPT carregada: POST /api/ai/chat');
