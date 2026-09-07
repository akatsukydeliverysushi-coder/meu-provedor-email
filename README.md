# Meu Provedor de E-mail

Projeto inicial de um provedor de e-mail particular.

## Estrutura atual

- `index.html` — tela de login
- `style.css` — visual da aplicação
- `app.js` — comportamento inicial

## Arquitetura planejada

```text
Usuário
  ↓
Frontend
  ↓
API de autenticação
  ↓
Banco de usuários
  ↓
Sessão / token
  ↓
Caixa de e-mail
```

## Segurança

- Senhas nunca devem ser armazenadas em texto puro.
- O backend deverá usar hash seguro para senhas.
- Sessões/tokens deverão ser gerados e validados no servidor.
- Credenciais SMTP, banco de dados, chaves privadas e outros segredos não devem ser publicados no GitHub.
- O frontend público não deve conter senhas de usuários ou credenciais administrativas.

## Próximos passos

1. Criar cadastro de usuários.
2. Criar backend de autenticação.
3. Criar banco de dados.
4. Implementar sessão/token.
5. Criar caixa de entrada.
6. Implementar envio e recebimento de e-mails.
7. Configurar domínio e servidor de e-mail.
