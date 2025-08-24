(function() {
  const countEl = document.getElementById('count');
  const statusEl = document.getElementById('status');
  const buttonEl = document.getElementById('be-there');

  const CLICK_KEY = 'be_there_clicked_v1';

  function updateCountText(n) {
    const people = n === 1 ? 'person' : 'people';
    countEl.textContent = `${n} ${people} will be there.`;
  }

  function setStatusClicked(clicked) {
    if (clicked) {
      statusEl.textContent = 'You have clicked the Be There Button. Please do not click the button again...';
      buttonEl.setAttribute('disabled', 'true');
      buttonEl.style.filter = 'grayscale(0.2)';
      buttonEl.style.cursor = 'not-allowed';
    } else {
      statusEl.textContent = 'You have not clicked the Be There Button.';
      buttonEl.removeAttribute('disabled');
      buttonEl.style.filter = '';
      buttonEl.style.cursor = 'pointer';
    }
  }

  async function fetchCount() {
    const res = await fetch('/api/count', { cache: 'no-store' });
    if (!res.ok) throw new Error('Failed to fetch count');
    const data = await res.json();
    return data.count ?? 0;
  }

  async function incrementCount() {
    const res = await fetch('/api/increment', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to increment');
    const data = await res.json();
    return data.count ?? 0;
  }

  async function init() {
    try {
      const [count, clicked] = await Promise.all([
        fetchCount(),
        Promise.resolve(localStorage.getItem(CLICK_KEY) === 'true')
      ]);
      updateCountText(count);
      setStatusClicked(clicked);
    } catch (err) {
      updateCountText(0);
      statusEl.textContent = 'Unable to load. Please refresh.';
    }
  }

  buttonEl.addEventListener('click', async () => {
    const clicked = localStorage.getItem(CLICK_KEY) === 'true';
    if (clicked) return; // guard double-clicks
    try {
      const count = await incrementCount();
      updateCountText(count);
      localStorage.setItem(CLICK_KEY, 'true');
      setStatusClicked(true);
    } catch (err) {
      statusEl.textContent = 'Error submitting. Please try again.';
    }
  });

  init();
})();


