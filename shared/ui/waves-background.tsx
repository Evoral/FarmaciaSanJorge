"use client";

/**
 * Full-viewport interactive background: vertical lines bent by Perlin noise
 * that the pointer pushes around like a spring field. Purely decorative
 * (aria-hidden, no pointer events), drawn on a canvas behind the page.
 *
 * Follows the app skin: the stroke is read from the `--color-brand` token
 * at mount, over the white `surface` color. Styling goes through Tailwind
 * classes only -- the production CSP has no 'unsafe-inline' for styles.
 *
 * With `prefers-reduced-motion: reduce` it draws a single static frame.
 */
import { useEffect, useRef } from "react";

const COL_GAP = 12;
const ROW_GAP = 34;
const STROKE_ALPHA = 0.28;

class PerlinNoise {
  private p = new Uint8Array(512);
  private grad3 = [
    [1, 1], [-1, 1], [1, -1], [-1, -1],
    [1, 0], [-1, 0], [1, 0], [-1, 0],
    [0, 1], [0, -1], [0, 1], [0, -1],
  ];

  constructor() {
    const s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s[i], s[j]] = [s[j], s[i]];
    }
    for (let i = 0; i < 512; i++) this.p[i] = s[i & 255];
  }

  perlin2(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);

    const fade = (t: number) => t * t * t * (t * (6 * t - 15) + 10);
    const lerp = (a: number, b: number, t: number) => a + t * (b - a);
    const dot = (idx: number, px: number, py: number) => this.grad3[idx][0] * px + this.grad3[idx][1] * py;

    const p = this.p;
    const n00 = dot(p[X + p[Y]] % 12, x, y);
    const n01 = dot(p[X + p[Y + 1]] % 12, x, y - 1);
    const n10 = dot(p[X + 1 + p[Y]] % 12, x - 1, y);
    const n11 = dot(p[X + 1 + p[Y + 1]] % 12, x - 1, y - 1);

    const u = fade(x);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), fade(y));
  }
}

interface Point {
  x: number;
  y: number;
  /** Noise displacement. */
  wx: number;
  wy: number;
  /** Pointer spring offset and its velocity. */
  cx: number;
  cy: number;
  cvx: number;
  cvy: number;
}

export function WavesBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const stroke = getComputedStyle(document.documentElement).getPropertyValue("--color-brand").trim() || "#03b386";
    const noise = new PerlinNoise();

    let width = 0;
    let height = 0;
    let columns: Point[][] = [];
    let frameId = 0;

    const mouse = { x: -999, y: 0, sx: -999, sy: 0, lx: 0, ly: 0, vs: 0, a: 0, set: false };

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas!.width = Math.round(width * dpr);
      canvas!.height = Math.round(height * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);

      const colCount = Math.ceil((width + 200) / COL_GAP);
      const rowCount = Math.ceil((height + 30) / ROW_GAP);
      const startX = (width - COL_GAP * colCount) / 2;
      const startY = (height - ROW_GAP * rowCount) / 2;

      columns = [];
      for (let i = 0; i <= colCount; i++) {
        const col: Point[] = [];
        for (let j = 0; j <= rowCount; j++) {
          col.push({ x: startX + COL_GAP * i, y: startY + ROW_GAP * j, wx: 0, wy: 0, cx: 0, cy: 0, cvx: 0, cvy: 0 });
        }
        columns.push(col);
      }
    }

    function step(time: number) {
      // Smoothed pointer position, speed and heading.
      mouse.sx += (mouse.x - mouse.sx) * 0.1;
      mouse.sy += (mouse.y - mouse.sy) * 0.1;
      const dx = mouse.sx - mouse.lx;
      const dy = mouse.sy - mouse.ly;
      mouse.vs = Math.min(100, mouse.vs + (Math.hypot(dx, dy) - mouse.vs) * 0.1);
      mouse.a = Math.atan2(dy, dx);
      mouse.lx = mouse.sx;
      mouse.ly = mouse.sy;

      const radius = Math.max(175, mouse.vs);
      for (const col of columns) {
        for (const pt of col) {
          const angle = 12 * noise.perlin2((pt.x + 0.012 * time) * 0.002, (pt.y + 0.005 * time) * 0.0015);
          pt.wx = 32 * Math.cos(angle);
          pt.wy = 16 * Math.sin(angle);

          const dist = Math.hypot(pt.x - mouse.sx, pt.y - mouse.sy);
          if (dist < radius) {
            const push = Math.cos(0.001 * dist) * (1 - dist / radius) * radius * mouse.vs * 0.00065;
            pt.cvx += Math.cos(mouse.a) * push;
            pt.cvy += Math.sin(mouse.a) * push;
          }

          // Spring back to the anchor, damped.
          pt.cvx = (pt.cvx - 0.005 * pt.cx) * 0.925;
          pt.cvy = (pt.cvy - 0.005 * pt.cy) * 0.925;
          pt.cx = Math.max(-100, Math.min(100, pt.cx + 2 * pt.cvx));
          pt.cy = Math.max(-100, Math.min(100, pt.cy + 2 * pt.cvy));
        }
      }
    }

    function draw() {
      ctx!.clearRect(0, 0, width, height);
      ctx!.beginPath();
      ctx!.strokeStyle = stroke;
      ctx!.globalAlpha = STROKE_ALPHA;
      ctx!.lineWidth = 0.6;

      for (const col of columns) {
        const first = col[0];
        ctx!.moveTo(first.x + first.wx + first.cx, first.y + first.wy + first.cy);
        for (let i = 0; i < col.length - 1; i++) {
          const curr = col[i];
          const next = col[i + 1];
          const p1x = curr.x + curr.wx + curr.cx;
          const p1y = curr.y + curr.wy + curr.cy;
          const p2x = next.x + next.wx + next.cx;
          const p2y = next.y + next.wy + next.cy;
          ctx!.quadraticCurveTo(p1x, p1y, (p1x + p2x) / 2, (p1y + p2y) / 2);
        }
      }
      ctx!.stroke();
    }

    function render(time: number) {
      step(time);
      draw();
      frameId = requestAnimationFrame(render);
    }

    function onPointerMove(e: PointerEvent) {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
      if (!mouse.set) {
        mouse.sx = mouse.lx = mouse.x;
        mouse.sy = mouse.ly = mouse.y;
        mouse.set = true;
      }
    }

    function onResize() {
      resize();
      if (reducedMotion) {
        step(0);
        draw();
      }
    }

    resize();
    window.addEventListener("resize", onResize);

    if (reducedMotion) {
      step(0);
      draw();
    } else {
      window.addEventListener("pointermove", onPointerMove, { passive: true });
      frameId = requestAnimationFrame(render);
    }

    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onPointerMove);
    };
  }, []);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-surface">
      <canvas ref={canvasRef} className="absolute inset-0 size-full" />
    </div>
  );
}
