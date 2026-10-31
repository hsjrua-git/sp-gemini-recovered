import { useEffect, useRef, useState } from 'react';
import { usePreferences } from '../preferences/PreferencesContext.jsx';

// Workstream I — the glowing-dot cursor (reference 3 / CyFocus).
//
// A layered pointer: a crisp core dot that tracks the mouse exactly, wrapped in
// several concentric hollow rings — a faded "circular wave" that lags behind it,
// each ring trailing a little more than the one inside so the halo ripples on
// the move and nests into calm concentric circles at rest (the one gentle
// flourish, kept soft to match the app-wide calm motion). It shrinks and springs
// back on click, blooms over actionable elements, and — the Hybrid decision —
// steps aside over
// text fields so the native caret stays precise in this data-entry-heavy app.
//
// It exists only for a true desktop mouse (a fine, hovering pointer) and never
// under reduced motion. The paint lives in index.css (the `.cursor-*` section);
// this file is the gate + the machinery.

// Live gate. Mirrors the matchMedia-subscription pattern in CountUp.jsx so a
// mid-session change — plugging in a mouse, toggling the OS reduced-motion
// setting — is picked up and the cursor mounts or unmounts accordingly.
function useCursorEnabled() {
  const evaluate = () =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: fine)').matches &&
    window.matchMedia('(hover: hover)').matches &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [enabled, setEnabled] = useState(evaluate);

  useEffect(() => {
    const queries = [
      window.matchMedia('(pointer: fine)'),
      window.matchMedia('(hover: hover)'),
      window.matchMedia('(prefers-reduced-motion: reduce)'),
    ];
    const update = () => setEnabled(evaluate());
    queries.forEach((q) => q.addEventListener('change', update));
    return () => queries.forEach((q) => q.removeEventListener('change', update));
  }, []);

  return enabled;
}

// Elements the ring should swell over (actionable) vs. text fields where we get
// out of the way and let the native caret show.
const CLICK_SELECTOR =
  'a[href], button, summary, label, select, [role="button"], .btn, ' +
  'input[type="button"], input[type="submit"], input[type="reset"], ' +
  'input[type="checkbox"], input[type="radio"], [data-cursor="interactive"]';
const TEXT_SELECTOR =
  'input:not([type="button"]):not([type="submit"]):not([type="reset"])' +
  ':not([type="checkbox"]):not([type="radio"]):not([type="range"])' +
  ':not([type="color"]):not([type="file"]):not([type="image"]):not([type="hidden"]), ' +
  'textarea, [contenteditable="true"], [contenteditable=""]';

// The concentric rings that make up the "wave" around the core dot, inner to
// outer. size is the diameter (px) and opacity the fade — larger rings are set
// fainter so the halo dissolves outward like a ripple. ease is each ring's
// per-frame catch-up toward the pointer (smaller = more lag), so on the move the
// outer rings trail into a wave and at rest they settle concentric. Diameter and
// opacity reach the paint via the inline --r-size / --r-o custom properties.
const WAVES = [
  { size: 26, ease: 0.22, opacity: 0.5 },
  { size: 42, ease: 0.16, opacity: 0.28 },
  { size: 60, ease: 0.11, opacity: 0.16 },
  { size: 80, ease: 0.07, opacity: 0.08 },
];

function Cursor() {
  const layerRef = useRef(null);
  const dotRef = useRef(null);

  useEffect(() => {
    const layer = layerRef.current;
    const dot = dotRef.current;
    if (!layer || !dot) return undefined;

    // Hides the native cursor (see the CSS `html.cursor-active` rule) only while
    // this layer is actually live, so a signed-off JS layer never leaves the page
    // without a visible pointer.
    const root = document.documentElement;
    root.classList.add('cursor-active');

    let targetX = 0;
    let targetY = 0;
    let placed = false;
    let visible = false;
    let rafId = 0;

    // The wave rings (rendered before the dot) and their eased centres, paired
    // by index with WAVES.
    const waves = Array.from(layer.querySelectorAll('.cursor-wave'));
    const wavePos = WAVES.map(() => ({ x: 0, y: 0 }));

    // Every ring eases toward the pointer a fraction each frame at its own rate;
    // once all of them have caught up we stop the loop, so there's no perpetual
    // rAF while idle.
    const drawRing = () => {
      rafId = 0;
      let moving = false;

      // The inner rings keep up and the outer ones trail, so the halo ripples on
      // the move and settles concentric at rest.
      for (let i = 0; i < WAVES.length; i += 1) {
        const p = wavePos[i];
        const dx = targetX - p.x;
        const dy = targetY - p.y;
        if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) {
          p.x = targetX;
          p.y = targetY;
        } else {
          p.x += dx * WAVES[i].ease;
          p.y += dy * WAVES[i].ease;
          moving = true;
        }
        waves[i].style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      }

      if (moving) rafId = requestAnimationFrame(drawRing);
    };

    const onMove = (e) => {
      targetX = e.clientX;
      targetY = e.clientY;
      dot.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
      if (!placed) {
        // First sighting: drop every ring straight onto the pointer instead of
        // letting them swoop in from the top-left origin.
        for (let i = 0; i < WAVES.length; i += 1) {
          wavePos[i].x = targetX;
          wavePos[i].y = targetY;
          waves[i].style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`;
        }
        placed = true;
      }
      if (!visible) {
        layer.classList.add('is-visible');
        visible = true;
      }
      if (!rafId) rafId = requestAnimationFrame(drawRing);
    };

    const onOver = (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      const overText = Boolean(t.closest(TEXT_SELECTOR));
      layer.classList.toggle('is-text', overText);
      layer.classList.toggle(
        'is-interactive',
        !overText && Boolean(t.closest(CLICK_SELECTOR)),
      );
    };

    const onDown = () => layer.classList.add('is-pressed');
    const onUp = () => layer.classList.remove('is-pressed');

    const hide = () => {
      layer.classList.remove('is-visible');
      visible = false;
    };
    // relatedTarget null on pointerout means the pointer left the window entirely.
    const onOut = (e) => {
      if (!e.relatedTarget) hide();
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerover', onOver, { passive: true });
    window.addEventListener('pointerdown', onDown, { passive: true });
    window.addEventListener('pointerup', onUp, { passive: true });
    window.addEventListener('pointerout', onOut, { passive: true });
    window.addEventListener('blur', hide);

    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerover', onOver);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointerout', onOut);
      window.removeEventListener('blur', hide);
      if (rafId) cancelAnimationFrame(rafId);
      root.classList.remove('cursor-active');
    };
  }, []);

  return (
    <div className="cursor-layer" ref={layerRef} aria-hidden="true">
      {WAVES.map((w) => (
        <div
          className="cursor-wave"
          key={w.size}
          style={{ '--r-size': `${w.size}px`, '--r-o': w.opacity }}
        >
          <i />
        </div>
      ))}
      <div className="cursor-dot" ref={dotRef}>
        <i />
      </div>
    </div>
  );
}

export default function CustomCursor() {
  const enabled = useCursorEnabled();
  const { preferences } = usePreferences();
  return enabled && preferences.customCursor !== false ? <Cursor /> : null;
}
