const loginForm = document.getElementById('loginForm');
const createAccount = document.getElementById('createAccount');
const message = document.getElementById('message');

function showMessage(text, error = false) {
  message.textContent = text;
  message.className = `message ${error ? 'error' : 'success'}`;
  message.hidden = false;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const button = loginForm.querySelector('button');
  button.disabled = true;
  button.textContent = 'Entrando...';

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível entrar.');
    window.location.href = '/dashboard.html';
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});

createAccount.addEventListener('click', () => {
  window.location.href = '/cadastro.html';
});
