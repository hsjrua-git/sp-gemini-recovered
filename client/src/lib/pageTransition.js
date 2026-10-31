// Pure choreography for the route-to-route transition.
//
// The page change is driven on the LIVE DOM (see App.jsx / AnimatedRoutes) with
// the Web Animations API rather than the View Transitions API: a short clear-out
// of the outgoing page, then a longer, staggered rebuild of the incoming one.
// Each top-level section animates on its OWN terms, chosen from two signals:
//   - its POSITION in the content area — a section on the right slides and fades
//     to the right, one at the top lifts to the top, one in the centre collapses
//     in place, and so on;
//   - its TYPE — a heading lifts, a toolbar/control strip slides aside, cards and
//     panels follow their position; and inside an entering section its own
//     buttons and fields get a small staggered entrance of their own.
//
// Everything here is pure (geometry in, keyframes/timing out) so it can be unit
// tested without a browser; App.jsx does the DOM reads and hands the results to
// element.animate(). All durations are in milliseconds.

export const MOTION = {
  // The outgoing page clears quickly — it's the rebuild that should feel slow.
  exit: {
    duration: 180,
    stagger: 12,
    maxStep: 5,
    easing: 'cubic-bezier(0.4, 0, 0.7, 0.25)',
  },
  // The incoming page rebuilds unhurriedly, section by section.
  enter: {
    duration: 420,
    stagger: 24,
    maxStep: 6,
    easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
  },
  // Buttons and fields inside an entering section, after the section itself.
  micro: {
    duration: 220,
    lead: 40,
    stagger: 12,
    max: 8,
    easing: 'cubic-bezier(0.33, 1, 0.68, 1)',
  },
  swapCap: 1200, // longest we'll wait for the target chunk before swapping anyway
  // First, uncached visits mount a page as a data-less shell; animating that
  // straight away means the real content pops in mid-flight (App.jsx holds the
  // incoming page hidden after the swap until it is READY, then animates it once,
  // fully formed). "Ready" is a dual gate, because neither signal alone is enough:
  //   - react-query has no fetch in flight (`queryClient.isFetching() === 0`), AND
  //   - the page DOM has been mutation-quiet for `settleQuiet` ms.
  // The fetch gate is needed because the DOM is naturally quiet *during* a network
  // wait (nothing has changed yet), so DOM-quiet alone would fire mid-load. The
  // DOM-quiet gate is needed because a query resolving isn't the same instant as
  // React committing its data, and because many pages gate a second query on the
  // first (e.g. `results` is `enabled` only once `periods` resolves) — between the
  // two, `isFetching()` momentarily reads 0 while the page is still a shell, so the
  // fetch gate alone reveals too early. Requiring a quiet beat AFTER the last fetch
  // drains bridges both the commit lag and that dependent-query gap.
  // A cached second visit has no fetch to wait for, so it settles at `settleGrace`.
  settleGrace: 120, // if no fetch has started within this, treat the page as static
  settleQuiet: 100, // required DOM-quiet beat after the last fetch drains
  settleCap: 1400, //  never hold the entrance longer than this, come what may
  // Late (data-driven) sections that mount after the swap are animated in with
  // the same position/type motion as the initial entrance. Keep watching until
  // the DOM has been quiet for `lateWindow`, but never longer than `lateCap`.
  lateWindow: 900, // quiet period (ms) after the last late section before we stop
  lateCap: 2600, // absolute ceiling (ms) on how long we keep watching
};

// How far sliding/rising sections travel. Kept modest so a slow clock reads as a
// glide rather than a dart.
const DIST = { x: 24, up: 14, down: 18 };

// Classify one top-level section from its tag + class names. Order matters:
// headings and control bars are recognised before the catch-all panel. Accepts a
// plain { tagName, className } descriptor so it's testable without a real node.
export function sectionRole({ tagName = '', className = '' } = {}) {
  const tag = String(tagName).toUpperCase();
  const cls = typeof className === 'string' ? className : String(className ?? '');
  if (
    tag === 'H1' ||
    tag === 'H2' ||
    /\b(page-head|page-header|page-heading|hint|summary-line)\b/.test(cls)
  )
    return 'head';
  if (/\b(toolbar|views-bar|filters?|controls|actions|tabs)\b/.test(cls)) return 'bar';
  if (/\b(section-card|stat-grid|param-grid|bento)\b/.test(cls) || tag === 'SECTION')
    return 'card';
  return 'panel';
}

// Where a section sits in the content area, from its centre relative to the
// container box. Full-width sections (most of the app) centre horizontally and so
// are placed by their vertical band; genuinely side-set elements go left/right.
export function zoneOf(rect, container) {
  const cw = container.width || 1;
  const ch = container.height || 1;
  const fx = ((rect.left + rect.right) / 2 - container.left) / cw;
  const fy = ((rect.top + rect.bottom) / 2 - container.top) / ch;
  if (fx > 0.66) return 'right';
  if (fx < 0.34) return 'left';
  if (fy < 0.4) return 'top';
  if (fy > 0.66) return 'bottom';
  return 'center';
}

// Resolve a section's motion from its type and position. Headings always lift to
// the top; control bars always slide aside; cards and panels follow their zone
// (right→right, left→left, top→up, bottom→down, centre→collapse in place).
export function resolveDirection(role, zone) {
  if (role === 'head') return 'up';
  if (role === 'bar') return zone === 'left' ? 'left' : 'right';
  switch (zone) {
    case 'right':
      return 'right';
    case 'left':
      return 'left';
    case 'top':
      return 'up';
    case 'bottom':
      return 'down';
    default:
      return 'collapse';
  }
}

// The "gone" transform for a direction — where a section rests when hidden. Exit
// animates from resting to this; enter animates from this back to resting, so a
// section leaves and returns along the same line.
//
// Deliberately transform + opacity only, NO `filter: blur()`. A `filter` on a
// section container turns it into a "backdrop root", which stops any frosted
// descendant (`.stat-card`, `.param-card`, `.panel` — all `backdrop-filter`)
// from sampling the page behind it, so the frost visibly drops out for the whole
// animation. Confirmed in-browser: transform/opacity leave the frost intact; a
// blur on the container kills it. Do not add a filter here.
function goneTransform(direction) {
  switch (direction) {
    case 'right':
      return `translateX(${DIST.x}px)`;
    case 'left':
      return `translateX(${-DIST.x}px)`;
    case 'up':
      return `translateY(${-DIST.up}px)`;
    case 'down':
      return `translateY(${DIST.down}px)`;
    case 'collapse':
    default:
      return 'scale(0.985) translateY(10px)';
  }
}

export function exitKeyframes(direction) {
  return [
    { opacity: 1, transform: 'none', offset: 0 },
    { opacity: 0, transform: goneTransform(direction), offset: 1 },
  ];
}

export function enterKeyframes(direction) {
  return [
    { opacity: 0, transform: goneTransform(direction), offset: 0 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

// Inner accents that get their own micro-entrance: buttons pop, fields rise.
// Anything else returns null (left to its section's block motion).
export function microKind({ tagName = '', className = '', role = '' } = {}) {
  const tag = String(tagName).toUpperCase();
  const cls = typeof className === 'string' ? className : '';
  if (tag === 'BUTTON' || role === 'button' || /\bbtn\b/.test(cls)) return 'button';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || /\bfield\b/.test(cls))
    return 'field';
  return null;
}

export function microKeyframes(kind) {
  if (kind === 'button')
    return [
      { opacity: 0, transform: 'scale(0.9)', offset: 0 },
      { opacity: 1, transform: 'none', offset: 1 },
    ];
  return [
    { opacity: 0, transform: 'translateY(8px)', offset: 0 },
    { opacity: 1, transform: 'none', offset: 1 },
  ];
}

// --- timing (pure) ---------------------------------------------------------
export function exitDelay(order) {
  return Math.min(order, MOTION.exit.maxStep) * MOTION.exit.stagger;
}

export function enterDelay(order) {
  return Math.min(order, MOTION.enter.maxStep) * MOTION.enter.stagger;
}

// How long to let the whole clear-out run before swapping, even if a promise is
// slow to settle: the last section's start plus its duration plus a little slack.
export function exitBudget(count) {
  return MOTION.exit.duration + exitDelay(Math.max(0, count - 1)) + 80;
}
