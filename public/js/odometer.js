// A mechanical-counter display: one rolling strip of 0–9 per digit.

const MIN_DIGITS = 3;

function createDigit() {
  const digit = document.createElement('span');
  digit.className = 'digit';
  const strip = document.createElement('span');
  strip.className = 'digit-strip';
  for (let n = 0; n <= 9; n += 1) {
    const cell = document.createElement('span');
    cell.textContent = String(n);
    strip.appendChild(cell);
  }
  digit.appendChild(strip);
  return digit;
}

/**
 * @param {HTMLElement} root
 * @returns {{ set(value: number): void }}
 */
export function createOdometer(root) {
  const digits = [];

  function ensureDigits(n) {
    while (digits.length < n) {
      const digit = createDigit();
      root.prepend(digit);
      digits.unshift(digit);
    }
  }

  function set(value) {
    const text = String(Math.max(0, Math.trunc(value)));
    ensureDigits(Math.max(MIN_DIGITS, text.length));
    const padded = text.padStart(digits.length, '0');
    digits.forEach((digit, index) => {
      digit.firstElementChild.style.setProperty('--n', padded[index]);
    });
  }

  ensureDigits(MIN_DIGITS);
  return { set };
}
