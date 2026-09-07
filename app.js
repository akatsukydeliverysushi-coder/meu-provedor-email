const loginForm = document.getElementById('loginForm');
const createAccount = document.getElementById('createAccount');
const message = document.getElementById('message');

function showMessage(text) {
  message.textContent = text;
  message.hidden = false;
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  showMessage('A interface está pronta. O próximo passo é conectar o login a um backend seguro.');
});

createAccount.addEventListener('click', () => {
  showMessage('A tela de cadastro será criada na próxima etapa.');
});
