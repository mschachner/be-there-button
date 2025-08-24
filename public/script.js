(function() {
  const countEl = document.getElementById('count');
  const statusEl = document.getElementById('status');
  const buttonEl = document.getElementById('be-there');
  const eventTextEl = document.getElementById('event-text');
  const adminLink = document.getElementById('admin-link');

  let currentCount = 0;

  function updateCountText(n) {
    currentCount = n;
    countEl.textContent = `${n} people will be there.`;
  }

  function setStatusClicked(clicked) {
    if (clicked) {
      statusEl.textContent = 'You have clicked the Be There Button. Please do not click the button again...';
      buttonEl.setAttribute('disabled', 'true');
      buttonEl.style.filter = 'grayscale(0.2)';
    } else {
      statusEl.textContent = 'You have not clicked the Be There Button.';
      buttonEl.removeAttribute('disabled');
      buttonEl.style.filter = '';
    }
  }

  async function fetchState() {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch state');
    return res.json();
  }

  async function incrementCount() {
    const res = await fetch('/api/increment', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to increment');
    return res.json();
  }

  async function init() {
    try {
      let state = window.__INITIAL_STATE__;
      if (!state) {
        state = await fetchState();
      }
      const { count, eventText, clicked } = state;
      updateCountText(count);
      eventTextEl.textContent = eventText;
      setStatusClicked(clicked);
    } catch (err) {
      updateCountText(0);
      statusEl.textContent = 'Unable to load. Please refresh.';
    }
  }

  buttonEl.addEventListener('click', async () => {
    if (buttonEl.hasAttribute('disabled')) return; // guard double-clicks
    const prev = currentCount;
    setStatusClicked(true);
    updateCountText(prev + 1);
    try {
      const { count } = await incrementCount();
      updateCountText(count);
    } catch (err) {
      statusEl.textContent = 'Error submitting. Please try again.';
      setStatusClicked(false);
      updateCountText(prev);
    }
  });

  adminLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const password = prompt('Enter admin password:');
    if (!password) return;
    const newText = prompt('Event Text:', eventTextEl.textContent);
    const reset = confirm('Reset count?');
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, eventText: newText, resetCount: reset })
      });
      if (res.status === 401) {
        alert('Invalid password');
        return;
      }
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      updateCountText(data.count ?? 0);
      eventTextEl.textContent = data.eventText ?? '';
      if (reset) {
        setStatusClicked(false);
      }
    } catch (_err) {
      alert('Admin action failed');
    }
  });

  init();
})();


