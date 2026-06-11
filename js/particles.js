/* ── CPU-reactive particle background ─────────────────────────── */

let canvas, ctx;
let particles = [];
let cpuLoad = 0;
let animId;
let frameCount = 0;
const FRAME_SKIP = 3; // run at ~20fps instead of 60fps (every 4th frame)

const CONFIG = {
  count: 35,
  maxSpeed: 0.8,
  minSpeed: 0.1,
  size: 2,
  color: 'rgba(153, 0, 0, 0.4)',
  colorHigh: 'rgba(204, 51, 51, 0.6)',
  connectDist: 120,
  connectColor: 'rgba(153, 0, 0, 0.08)',
  connectColorHigh: 'rgba(204, 51, 51, 0.12)',
};

function init() {
  canvas = document.createElement('canvas');
  canvas.id = 'particle-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0;opacity:0.6;';
  document.body.prepend(canvas);
  ctx = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < CONFIG.count; i++) {
    particles.push(createParticle());
  }

  animate();
}

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}

function createParticle() {
  const angle = Math.random() * Math.PI * 2;
  const speed = CONFIG.minSpeed + Math.random() * (CONFIG.maxSpeed - CONFIG.minSpeed);
  return {
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size: 1 + Math.random() * CONFIG.size,
  };
}

function animate() {
  // Skip frames to throttle to ~20fps
  frameCount++;
  if (frameCount <= FRAME_SKIP) {
    animId = requestAnimationFrame(animate);
    return;
  }
  frameCount = 0;

  // Skip entirely when tab is hidden
  if (document.hidden) {
    animId = requestAnimationFrame(animate);
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Scale speed by CPU load (0-100 → 0.5x-3x)
  const multiplier = 0.5 + (cpuLoad / 100) * 2.5;
  const isHot = cpuLoad > 50;

  // Update & draw particles
  for (const p of particles) {
    p.x += p.vx * multiplier;
    p.y += p.vy * multiplier;

    // Wrap around
    if (p.x < 0) p.x = canvas.width;
    if (p.x > canvas.width) p.x = 0;
    if (p.y < 0) p.y = canvas.height;
    if (p.y > canvas.height) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fillStyle = isHot ? CONFIG.colorHigh : CONFIG.color;
    ctx.fill();
  }

  // Draw connections
  const maxDist = CONFIG.connectDist * (1 + cpuLoad / 200);
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x;
      const dy = particles[i].y - particles[j].y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < maxDist) {
        const alpha = 1 - dist / maxDist;
        ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y);
        ctx.lineTo(particles[j].x, particles[j].y);
        ctx.strokeStyle = isHot
          ? `rgba(204, 51, 51, ${alpha * 0.12})`
          : `rgba(153, 0, 0, ${alpha * 0.08})`;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
    }
  }

  animId = requestAnimationFrame(animate);
}

export function updateCPULoad(load) {
  cpuLoad = load || 0;
}

// Auto-init
init();
