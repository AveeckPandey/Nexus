'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export type BlinkingSquaresDirection = 'right' | 'left' | 'top' | 'bottom';

export interface BlinkingSquaresProps {
  /** Edge the dense squares are anchored to. The grid fades to empty in the opposite direction. */
  direction?: BlinkingSquaresDirection;
  /** Number of grid cells along the long axis (8–200). Higher = finer grain. */
  gridSize?: number;
  /** Constant square fill % within each cell (0.05–0.98). Density is what varies. */
  squareSize?: number;
  /** Where the field first becomes non-empty along `direction` (0–1). */
  fadeStart?: number;
  /** Where the field reaches full density along `direction` (0–1). Must be > fadeStart. */
  fadeEnd?: number;
  /** Curve sharpness between fadeStart and fadeEnd. 1 = linear (0.3–6). */
  falloff?: number;
  /** Minimum brightness of a lit cell (0–1). Lit cells get a random brightness between this and 1.0. */
  minBrightness?: number;
  /** Per-cell twinkle rate in cycles per second (0–4). 0 freezes the field. */
  twinkleSpeed?: number;
  /** Strength of the per-cell brightness oscillation (0–1). 0 = no blinking. */
  twinkleStrength?: number;
  /** Master brightness multiplier (0–2). */
  intensity?: number;
  /** Master alpha (0–1). */
  opacity?: number;
  /** Square color in hex. */
  squareColor?: string;
  /** Background fill where the field is empty, in hex. Use "transparent" to skip painting. */
  backgroundColor?: string;
  /** Maximum device pixel ratio cap (1–3). */
  dpr?: number;
  className?: string;
  style?: React.CSSProperties;
  'aria-hidden'?: boolean | 'true' | 'false';
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (h.length === 4) h = h.slice(0, 3).split('').map((c) => c + c).join('');
  if (h.length > 6) h = h.slice(0, 6);
  const num = parseInt(h, 16);
  if (Number.isNaN(num) || h.length !== 6) return [187, 41, 255];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

/** Deterministic 0–1 hash per cell so density never flickers — only brightness twinkles. */
function hash2(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

/**
 * Local stand-in for the React Bits Pro `blinking-squares-tw` component.
 * Same props API as https://pro.reactbits.dev/docs/components/blinking-squares so the
 * official file (via `npx shadcn add @reactbits-starter/blinking-squares-tw`) can
 * overwrite this file without changing imports.
 */
export function BlinkingSquares({
  direction = 'right',
  gridSize = 52,
  squareSize = 0.57,
  fadeStart = 0.65,
  fadeEnd = 1,
  falloff = 1.25,
  minBrightness = 0.55,
  twinkleSpeed = 1.4,
  twinkleStrength = 0.94,
  intensity = 1,
  opacity = 1,
  squareColor = '#BB29FF',
  backgroundColor = '#000000',
  dpr = 1.5,
  className,
  style,
  ...rest
}: BlinkingSquaresProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const gs = clamp(Math.round(gridSize), 8, 200);
    const fill = clamp(squareSize, 0.05, 0.98);
    const fs = clamp(fadeStart, 0, 1);
    const fe = clamp(fadeEnd, 0, 1);
    const span = Math.max(1e-4, fe - fs);
    const curve = clamp(falloff, 0.3, 6);
    const minB = clamp(minBrightness, 0, 1);
    const speed = clamp(twinkleSpeed, 0, 4);
    const strength = clamp(twinkleStrength, 0, 1);
    const gain = clamp(intensity, 0, 2);
    const alpha = clamp(opacity, 0, 1);
    const maxDpr = clamp(dpr, 1, 3);
    const [r, g, b] = hexToRgb(squareColor);
    const paintBg = backgroundColor.toLowerCase() !== 'transparent';

    let raf = 0;
    let running = true;
    let visible = true;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

    // Per-cell randoms (brightness base, phase, slight rate jitter for an organic feel)
    const base: number[] = [];
    const phase: number[] = [];
    const jitter: number[] = [];
    const cells = gs * gs; // upper bound; actual cols*rows <= this
    for (let i = 0; i < cells; i++) {
      base.push(minB + hash2(i, 7) * (1 - minB));
      phase.push(hash2(i, 13) * Math.PI * 2);
      jitter.push(0.85 + hash2(i, 29) * 0.3);
    }

    const resize = () => {
      const parent = canvas.parentElement;
      const w = parent ? parent.clientWidth : canvas.clientWidth || window.innerWidth;
      const h = parent ? parent.clientHeight : canvas.clientHeight || window.innerHeight;
      const ratio = Math.min(maxDpr, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * ratio));
      canvas.height = Math.max(1, Math.round(h * ratio));
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);
    window.addEventListener('resize', resize);

    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && running && !reduced && speed > 0) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    });
    io.observe(canvas);

    const densityAt = (col: number, row: number, cols: number, rows: number) => {
      let t: number;
      if (direction === 'right') t = cols <= 1 ? 1 : col / (cols - 1);
      else if (direction === 'left') t = cols <= 1 ? 1 : 1 - col / (cols - 1);
      else if (direction === 'bottom') t = rows <= 1 ? 1 : row / (rows - 1);
      else t = rows <= 1 ? 1 : 1 - row / (rows - 1);
      if (t <= fs) return 0;
      if (t >= fe) return 1;
      return Math.pow((t - fs) / span, curve);
    };

    const draw = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      if (w === 0 || h === 0) return;
      const landscape = w >= h;
      const cols = landscape ? gs : Math.max(1, Math.round((gs * w) / h));
      const rows = landscape ? Math.max(1, Math.round((gs * h) / w)) : gs;
      const cellW = w / cols;
      const cellH = h / rows;
      const sqW = cellW * fill;
      const sqH = cellH * fill;
      const time = now / 1000;

      if (paintBg) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = backgroundColor;
        ctx.fillRect(0, 0, w, h);
      } else {
        ctx.clearRect(0, 0, w, h);
      }

      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const d = densityAt(x, y, cols, rows);
          if (d <= 0) continue;
          const idx = (y * gs + x) % cells;
          if (hash2(x, y) >= d) continue; // density varies, size stays constant
          let bright = base[idx];
          if (!reduced && speed > 0 && strength > 0) {
            const osc = 0.5 - 0.5 * Math.cos(2 * Math.PI * speed * jitter[idx] * time + phase[idx]);
            bright = base[idx] * (1 - strength * osc);
          }
          const a = clamp(bright * gain, 0, 1) * alpha;
          if (a <= 0.004) continue;
          ctx.globalAlpha = a;
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          const px = x * cellW + (cellW - sqW) / 2;
          const py = y * cellH + (cellH - sqH) / 2;
          ctx.fillRect(px, py, sqW, sqH);
        }
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      if (!running) return;
      if (visible && !document.hidden) draw(now);
      if (!reduced && speed > 0) raf = requestAnimationFrame(loop);
    };

    if (reduced || speed === 0) {
      draw(0); // single static frame
    } else {
      raf = requestAnimationFrame(loop);
    }
    const onVis = () => {
      if (!document.hidden && visible && running && !reduced && speed > 0) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [direction, gridSize, squareSize, fadeStart, fadeEnd, falloff, minBrightness, twinkleSpeed, twinkleStrength, intensity, opacity, squareColor, backgroundColor, dpr]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('block h-full w-full', className)}
      style={style}
      aria-hidden={rest['aria-hidden'] ?? true}
    />
  );
}

export default BlinkingSquares;
