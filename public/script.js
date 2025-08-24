(function() {
  const countEl = document.getElementById('count');
  const statusEl = document.getElementById('status');
  const buttonEl = document.getElementById('be-there');
  const eventTextEl = document.getElementById('event-text');
  const adminLink = document.getElementById('admin-link');
  const adminDialog = document.getElementById('admin-dialog');
  const adminForm = document.getElementById('admin-form');
  const adminPasswordInput = document.getElementById('admin-password');
  const adminEventInput = document.getElementById('admin-event-text');
  const adminResetInput = document.getElementById('admin-reset');
  const adminCancelBtn = document.getElementById('admin-cancel');

  let currentCount = 0;

  function updateCountText(n) {
    currentCount = n;
    const label = n === 1 ? 'person' : 'people';
    countEl.textContent = `${n} ${label} will be there.`;
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

  function runConfetti() {
    const confettiCode = 'U2FsdGVkX1/Rnrf5mykavzFnqRfU3Wyr3I23mMc3JzbfEusXRL5J4idWepfxeMqQXvVBkntL0jpgMMNL8bRzahrDeV/ncW4h6R2HcSChmAIQvxGEroUwX4HmA/c0ubQjYhTeJ1hfEpGHZtVxENjja96cQ0IMsdGJvB5TMazSALVY7C5tZVf3Ooqee9R3YPC5aaK/JFOTSZ2ERuvm5suXKcLJFLDwTTQhXvpsLwNFnj8Sb+ADz7ZFuWFn9glBP4SYP1xfcbYUEzI6H3wCUeBBeJFn20il/wz/+5qrt9CGkVFTFL8B7KsP5LkaBoxBmEZux4wVFGuAeSuAkNqXVq0ydqlBKVlRtAazjH4jhmVEDYFFRVUpSxv8ZvwfQpLS1yAUK7infcvKrf3QkmLQHH95yn6zQPRWpQ1UglOXF9Kw85morIysr4m5UkmvzcgH+milRIAuKyQhB8GbdEXwJgy5ckrftogl4E+1YzZMRxqma3LWDw73lHDaisj/JV4IPOhV4F1Ibr+RjZwG9pK+Z4MgJb1Dy/GntrkZkZd/T3rGH9RCyynEyG6mIrMiQm1j9FF0CTTXjPctZ5reQ9frP+xb431yoxfrgFHzoZ2EDDqM7dBdDktCL76KJQRK5JYezB+HAAVKDIvwLVT1OxYV7i/ibaUfRA74hgVxY1uM9SM7WxYXhJTJa/stR5QshIKfEMpn7LNTJWxbk5erKVnYsRGchkGgE80DFqR3lLpjGOHkZg1JRPJnxSKuyDLf+dwDDHdQINLGm8fGkldt9Jp+8jEtysVUoQI9gWKg2Kz34kzGfWs=';
    const s = document.createElement('script');
    s.src = 'https://run.confettipage.com/here.js';
    s.setAttribute('data-confetticode', confettiCode);
    document.body.appendChild(s);
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
      runConfetti();
    } catch (err) {
      statusEl.textContent = 'Error submitting. Please try again.';
      setStatusClicked(false);
      updateCountText(prev);
    }
  });

  adminLink.addEventListener('click', (e) => {
    e.preventDefault();
    adminPasswordInput.value = '';
    adminEventInput.value = eventTextEl.textContent;
    adminResetInput.checked = false;
    adminDialog.showModal();
  });

  adminCancelBtn.addEventListener('click', () => {
    adminDialog.close();
  });

  adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = adminPasswordInput.value;
    if (!password) return;
    const newText = adminEventInput.value;
    const reset = adminResetInput.checked;
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
      adminDialog.close();
    } catch (err) {
      // Ignore aborted requests (e.g., page refresh) but surface other errors
      if (err && err.name === 'AbortError') return;
      alert('Admin action failed');
    }
  });

  init();
})();


