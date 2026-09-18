// Entry point: wires the button, the tally, the status line and the admin dialog.

import { getState, increment } from './api.js';
import { createOdometer } from './odometer.js';
import { burstConfetti } from './confetti.js';
import { setupAdmin } from './admin.js';

// All user-facing copy lives here.
const TEXT = {
  notClicked: 'You have not clicked the Be There Button.',
  clicked: 'You have clicked the Be There Button. Please do not click the button again...',
  loadFailed: 'Unable to load. Please refresh.',
  submitFailed: 'Error submitting. Please try again.',
  countSuffix: n => `${n === 1 ? 'person' : 'people'} will be there.`,
  warning: {
    lead:
      'WARNING! You have now clicked the Be There Button multiple times. ' +
      'This is strictly prohibited. Please exit this page immediately. ' +
      'Under no circumstances should you click the Be There Button additional times.',
    apologyPrefix: 'If you would like to apologize for clicking the button multiple times, please submit the ',
    apologyLink: 'Official Math Department Repeated Be There Button Click Apology Form',
    apologySuffix: '.'
  }
};

const APOLOGY_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSeamo8gOigN_if6rcxP3minuFPTW-BS4uoJ5X8pmkncs_PSXQ/viewform?usp=header';

const MAX_SIN = 6; // extra clicks after which the vignette stops deepening

const els = {
  button: document.getElementById('be-there'),
  plate: document.querySelector('.plate'),
  eventText: document.getElementById('event-text'),
  count: document.getElementById('count'),
  odometer: document.getElementById('odometer'),
  status: document.getElementById('status')
};

const odometer = createOdometer(els.odometer);

const state = {
  count: 0,
  clicked: false,
  extraClicks: 0
};

// --- Rendering -------------------------------------------------------------

function renderCount(count) {
  state.count = count;
  odometer.set(count);
  const number = document.createElement('span');
  number.className = 'sr-only';
  number.textContent = `${count} `;
  els.count.replaceChildren(number, TEXT.countSuffix(count));
}

function renderEventText(text) {
  els.eventText.textContent = text;
}

function setStatus(message, variant = '') {
  els.status.className = variant ? `status ${variant}` : 'status';
  els.status.textContent = message;
}

function renderClicked(clicked) {
  state.clicked = clicked;
  els.button.classList.toggle('clicked', clicked);
  if (!clicked) {
    els.button.classList.remove('evil');
    state.extraClicks = 0;
    document.documentElement.style.setProperty('--sin', '0');
  }
  setStatus(clicked ? TEXT.clicked : TEXT.notClicked, clicked ? 'clicked' : '');
}

function renderWarning() {
  const lead = document.createElement('p');
  lead.textContent = TEXT.warning.lead;

  const link = document.createElement('a');
  link.href = APOLOGY_FORM_URL;
  link.target = '_blank';
  link.rel = 'noopener';
  link.textContent = TEXT.warning.apologyLink;

  const apology = document.createElement('p');
  apology.append(TEXT.warning.apologyPrefix, link, TEXT.warning.apologySuffix);

  els.status.className = 'status warning';
  els.status.replaceChildren(lead, apology);
}

function shakePlate() {
  els.plate.classList.remove('shake');
  void els.plate.offsetWidth; // restart the animation
  els.plate.classList.add('shake');
}

// --- Behaviour -------------------------------------------------------------

function buttonCenter() {
  const rect = els.button.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

async function handleFirstClick() {
  const previousCount = state.count;
  renderClicked(true);
  renderCount(previousCount + 1);
  burstConfetti(buttonCenter());
  try {
    const { count } = await increment();
    renderCount(count);
  } catch {
    renderClicked(false);
    renderCount(previousCount);
    setStatus(TEXT.submitFailed, 'error');
  }
}

function handleForbiddenClick() {
  state.extraClicks += 1;
  els.button.classList.remove('clicked');
  els.button.classList.add('evil');
  document.documentElement.style.setProperty('--sin', String(Math.min(state.extraClicks, MAX_SIN) / MAX_SIN));
  shakePlate();
  renderWarning();
}

els.button.addEventListener('click', () => {
  if (state.clicked) handleForbiddenClick();
  else handleFirstClick();
});

els.plate.addEventListener('animationend', () => els.plate.classList.remove('shake'));

setupAdmin({
  getEventText: () => els.eventText.textContent,
  onSaved: ({ count, eventText, reset }) => {
    renderCount(count);
    renderEventText(eventText);
    if (reset) renderClicked(false);
  }
});

async function init() {
  try {
    const { count, eventText, clicked } = await getState();
    renderCount(count);
    renderEventText(eventText);
    renderClicked(clicked);
  } catch {
    renderCount(0);
    setStatus(TEXT.loadFailed, 'error');
  }
}

init();
