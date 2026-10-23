document.addEventListener('click', (event) => {
  const button = event.target.closest('.password-toggle-button');
  if (!button) return;

  const wrapper = button.closest('.password-toggle');
  const input = wrapper && wrapper.querySelector('input[type="password"], input[type="text"]');
  if (!input) return;

  const isVisible = input.type === 'password';
  input.type = isVisible ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(isVisible));
  button.setAttribute('aria-label', isVisible ? 'Hide password' : 'Show password');
  button.title = isVisible ? 'Hide password' : 'Show password';
  wrapper.querySelector('.password-eye').hidden = isVisible;
  wrapper.querySelector('.password-eye-off').hidden = !isVisible;
});
