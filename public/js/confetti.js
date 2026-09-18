// A short burst of confetti from a point on the screen.

const COLORS = ['#c9352b', '#e0b34a', '#3f8f52', '#2f6fb7', '#f5eee2', '#e28a5d'];
const PIECE_COUNT = 140;
const DURATION_MS = 2600;
const GRAVITY = 0.16;
const DRAG = 0.985;

function random(min, max) {
  return min + Math.random() * (max - min);
}

function createPiece(originX, originY) {
  const angle = random(-Math.PI, 0) + random(-0.5, 0.5); // mostly upward
  const speed = random(6, 15);
  return {
    x: originX,
    y: originY,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    rotation: random(0, Math.PI * 2),
    spin: random(-0.25, 0.25),
    width: random(6, 10),
    height: random(8, 16),
    round: Math.random() < 0.25,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    wobble: random(0, Math.PI * 2)
  };
}

/**
 * @param {{ x: number, y: number }} origin viewport coordinates
 */
export function burstConfetti(origin) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return;

  const scale = window.devicePixelRatio || 1;
  canvas.className = 'confetti-canvas';
  canvas.width = window.innerWidth * scale;
  canvas.height = window.innerHeight * scale;
  context.scale(scale, scale);
  document.body.appendChild(canvas);

  const pieces = Array.from({ length: PIECE_COUNT }, () => createPiece(origin.x, origin.y));
  const startedAt = performance.now();

  function frame(now) {
    const elapsed = now - startedAt;
    const fade = elapsed > DURATION_MS - 600 ? Math.max(0, (DURATION_MS - elapsed) / 600) : 1;
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    context.globalAlpha = fade;

    for (const piece of pieces) {
      piece.vy += GRAVITY;
      piece.vx *= DRAG;
      piece.vy *= DRAG;
      piece.wobble += 0.1;
      piece.x += piece.vx + Math.sin(piece.wobble) * 0.6;
      piece.y += piece.vy;
      piece.rotation += piece.spin;

      context.save();
      context.translate(piece.x, piece.y);
      context.rotate(piece.rotation);
      context.fillStyle = piece.color;
      if (piece.round) {
        context.beginPath();
        context.arc(0, 0, piece.width / 2, 0, Math.PI * 2);
        context.fill();
      } else {
        // Squash on the x axis to fake a tumbling flat piece.
        const squash = Math.abs(Math.cos(piece.wobble));
        context.fillRect(-piece.width / 2, -piece.height / 2, piece.width * Math.max(squash, 0.2), piece.height);
      }
      context.restore();
    }

    if (elapsed < DURATION_MS) requestAnimationFrame(frame);
    else canvas.remove();
  }

  requestAnimationFrame(frame);
}
