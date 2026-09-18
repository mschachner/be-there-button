// The password-protected admin dialog.

import { updateAdmin, ApiError } from './api.js';

const ERRORS = {
  401: 'Invalid password',
  429: 'Too many failed attempts. Please try again later.',
  fallback: 'Admin action failed'
};

/**
 * @param {object} options
 * @param {() => string} options.getEventText  current event text, used to prefill the form
 * @param {(state: {count: number, eventText: string, reset: boolean}) => void} options.onSaved
 */
export function setupAdmin({ getEventText, onSaved }) {
  const link = document.getElementById('admin-link');
  const dialog = document.getElementById('admin-dialog');
  const form = document.getElementById('admin-form');
  const passwordInput = document.getElementById('admin-password');
  const eventInput = document.getElementById('admin-event-text');
  const countInput = document.getElementById('admin-count');
  const resetInput = document.getElementById('admin-reset');
  const cancelButton = document.getElementById('admin-cancel');
  const submitButton = document.getElementById('admin-submit');
  const errorEl = document.getElementById('admin-error');

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function open() {
    passwordInput.value = '';
    eventInput.value = getEventText();
    countInput.value = '';
    resetInput.checked = false;
    showError('');
    dialog.showModal();
    passwordInput.focus();
  }

  async function submit(event) {
    event.preventDefault();
    const password = passwordInput.value;
    if (!password) {
      passwordInput.focus();
      return;
    }

    const payload = {
      password,
      eventText: eventInput.value,
      resetCount: resetInput.checked
    };
    if (countInput.value !== '') payload.count = Number(countInput.value);

    submitButton.disabled = true;
    showError('');
    try {
      const data = await updateAdmin(payload);
      onSaved({ count: data.count ?? 0, eventText: data.eventText ?? '', reset: payload.resetCount });
      dialog.close();
    } catch (error) {
      if (error && error.name === 'AbortError') return; // page navigated away mid-request
      const status = error instanceof ApiError ? error.status : undefined;
      showError(ERRORS[status] || ERRORS.fallback);
    } finally {
      submitButton.disabled = false;
    }
  }

  link.addEventListener('click', event => {
    event.preventDefault();
    open();
  });
  cancelButton.addEventListener('click', () => dialog.close());
  form.addEventListener('submit', submit);
}
