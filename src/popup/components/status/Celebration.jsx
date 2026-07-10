import { useEffect, useRef, useState } from 'react';

const CONFETTI_COLORS = ['#1a73e8', '#34a853', '#fbbc04', '#ea4335', '#a142f4', '#24c1e0', '#f28b82', '#ccff90', '#ff8a65', '#80deea', '#ff80ab', '#ffe57f'];

class ConfettiPiece {
  constructor(cw, ch) {
    this.x = Math.random() * cw;
    this.y = -10 - Math.random() * 80;
    this.w = 8 + Math.random() * 8;
    this.h = this.w * (0.2 + Math.random() * 0.2);
    this.vx = (Math.random() - 0.5) * 3;
    this.vy = 1.5 + Math.random() * 2.5;
    this.angle = Math.random() * Math.PI * 2;
    this.angleVel = (Math.random() - 0.5) * 0.18;
    this.wobble = Math.random() * Math.PI * 2;
    this.wobbleVel = 0.08 + Math.random() * 0.06;
    this.color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];
    this.opacity = 1;
    this.gravity = 0.07 + Math.random() * 0.04;
    this.drag = 0.98;
  }
  update(ch) {
    this.wobble += this.wobbleVel;
    this.vy += this.gravity;
    this.vx *= this.drag;
    this.x += this.vx + Math.sin(this.wobble) * 0.6;
    this.y += this.vy;
    this.angle += this.angleVel;
    if (this.y > ch - 30) this.opacity = Math.max(0, this.opacity - 0.03);
    return this.y < ch + 20 && this.opacity > 0;
  }
  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.w / 2, -this.h / 2, this.w, this.h);
    ctx.restore();
  }
}

export default function Celebration({ status, company, title, onDone }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    canvas.width = container.offsetWidth || 360;
    canvas.height = container.offsetHeight || 320;
    const ctx = canvas.getContext('2d');
    let pieces = [];
    let animId;

    const cw = canvas.width, ch = canvas.height;
    const spawn = count => { for (let i = 0; i < count; i++) pieces.push(new ConfettiPiece(cw, ch)); };

    spawn(90);
    const spawnTimers = [
      setTimeout(() => spawn(70), 300),
      setTimeout(() => spawn(50), 700)
    ];

    function tick() {
      ctx.clearRect(0, 0, cw, ch);
      pieces = pieces.filter(p => { const alive = p.update(ch); p.draw(ctx); return alive; });
      if (pieces.length > 0) animId = requestAnimationFrame(tick);
    }
    const startTimer = setTimeout(tick, 30);

    let secs = 5;
    const interval = setInterval(() => {
      secs -= 1;
      setCountdown(secs);
      if (secs <= 0) {
        clearInterval(interval);
        onDone();
      }
    }, 1000);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(startTimer);
      spawnTimers.forEach(clearTimeout);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '32px 24px', minHeight: 320, position: 'relative', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ fontSize: 56, marginBottom: 12 }}>{status === '✅ Offer Accepted' ? '✅' : '🎁'}</div>
        <div style={{ fontSize: 18, fontWeight: 500, color: '#1a1a1a', marginBottom: 6 }}>
          {status === '✅ Offer Accepted' ? 'Offer accepted! Congratulations!' : 'Offer received!'}
        </div>
        <div style={{ fontSize: 13, color: '#666' }}>{company && title ? `${company} · ${title}` : company || title || ''}</div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 16, opacity: 0.8 }}>Saved to your sheet ✓</div>
        <div style={{ marginTop: 20, fontSize: 11, color: '#888' }}>
          Closing in <span style={{ fontWeight: 600, color: '#1a1a1a' }}>{countdown}</span>s
        </div>
      </div>
    </div>
  );
}
