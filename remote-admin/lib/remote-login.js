'use strict';

const form = document.getElementById('auth-form');
const input = document.getElementById('auth-password');
const button = form.querySelector('button');
const feedback = document.getElementById('auth-feedback');
button.disabled = false;
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  button.disabled = true;
  feedback.textContent = 'Đang đăng nhập…';
  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: input.value }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (response.ok && result.authenticated === true) {
      input.value = '';
      location.reload();
      return;
    }
    feedback.textContent = result.error?.message ?? 'Không thể đăng nhập.';
  } catch {
    feedback.textContent = 'Không thể kết nối. Hãy thử lại.';
  } finally {
    button.disabled = false;
  }
});
