import { describe, it, expect } from 'vitest';
import {
  MOTION,
  sectionRole,
  zoneOf,
  resolveDirection,
  exitKeyframes,
  enterKeyframes,
  microKind,
  microKeyframes,
  exitDelay,
  enterDelay,
  exitBudget,
} from './pageTransition.js';

// Pure choreography: geometry/descriptors in, keyframes/timing out. Everything
// here is testable without a browser (App.jsx does the DOM reads and hands the
// results to element.animate()).

describe('sectionRole', () => {
  it('classifies headings by tag', () => {
    expect(sectionRole({ tagName: 'H1', className: '' })).toBe('head');
    expect(sectionRole({ tagName: 'h2', className: '' })).toBe('head');
  });

  it('classifies headings by class name', () => {
    expect(sectionRole({ tagName: 'DIV', className: 'page-head' })).toBe('head');
    expect(sectionRole({ tagName: 'DIV', className: 'hint' })).toBe('head');
    expect(sectionRole({ tagName: 'P', className: 'summary-line' })).toBe('head');
  });

  it('classifies control bars', () => {
    expect(sectionRole({ tagName: 'DIV', className: 'toolbar' })).toBe('bar');
    expect(sectionRole({ tagName: 'DIV', className: 'views-bar' })).toBe('bar');
    expect(sectionRole({ tagName: 'DIV', className: 'filters' })).toBe('bar');
    expect(sectionRole({ tagName: 'DIV', className: 'filter' })).toBe('bar');
  });

  it('classifies cards by class or SECTION tag', () => {
    expect(sectionRole({ tagName: 'DIV', className: 'section-card' })).toBe('card');
    expect(sectionRole({ tagName: 'DIV', className: 'stat-grid' })).toBe('card');
    expect(sectionRole({ tagName: 'SECTION', className: '' })).toBe('card');
  });

  it('falls back to panel', () => {
    expect(sectionRole({ tagName: 'DIV', className: 'whatever' })).toBe('panel');
    expect(sectionRole({})).toBe('panel');
  });

  it('prefers head over bar/card when several patterns could match', () => {
    // H1 wins even if it also carries a bar-ish class.
    expect(sectionRole({ tagName: 'H1', className: 'toolbar' })).toBe('head');
  });

  it('does not match class fragments across word boundaries', () => {
    // \b guards: "subtabs" / "actionable" must not read as bar.
    expect(sectionRole({ tagName: 'DIV', className: 'subtabs' })).toBe('panel');
    expect(sectionRole({ tagName: 'DIV', className: 'actionable' })).toBe('panel');
  });
});

describe('zoneOf', () => {
  const container = { left: 0, top: 0, width: 1000, height: 800 };
  const at = (cx, cy) => ({ left: cx - 5, right: cx + 5, top: cy - 5, bottom: cy + 5 });

  it('places genuinely side-set elements left/right by horizontal centre', () => {
    expect(zoneOf(at(900, 400), container)).toBe('right'); // fx 0.9
    expect(zoneOf(at(100, 400), container)).toBe('left'); //  fx 0.1
  });

  it('places full-width elements by vertical band', () => {
    // fx ~0.5 (centred horizontally) → decided by fy.
    expect(zoneOf(at(500, 80), container)).toBe('top'); //    fy 0.1
    expect(zoneOf(at(500, 720), container)).toBe('bottom'); // fy 0.9
    expect(zoneOf(at(500, 400), container)).toBe('center'); // fy 0.5
  });

  it('honours the container offset', () => {
    const offset = { left: 200, top: 100, width: 1000, height: 800 };
    // Centre at x=1100 → fx (1100-200)/1000 = 0.9 → right.
    expect(zoneOf(at(1100, 500), offset)).toBe('right');
  });

  it('guards against a zero-size container', () => {
    expect(() => zoneOf(at(10, 10), { left: 0, top: 0, width: 0, height: 0 })).not.toThrow();
  });
});

describe('resolveDirection', () => {
  it('always lifts headings to the top', () => {
    expect(resolveDirection('head', 'right')).toBe('up');
    expect(resolveDirection('head', 'center')).toBe('up');
  });

  it('slides bars aside — left only when the bar sits left', () => {
    expect(resolveDirection('bar', 'left')).toBe('left');
    expect(resolveDirection('bar', 'right')).toBe('right');
    expect(resolveDirection('bar', 'center')).toBe('right');
    expect(resolveDirection('bar', 'top')).toBe('right');
  });

  it('sends cards/panels along their zone, centre collapsing in place', () => {
    expect(resolveDirection('card', 'right')).toBe('right');
    expect(resolveDirection('panel', 'left')).toBe('left');
    expect(resolveDirection('card', 'top')).toBe('up');
    expect(resolveDirection('panel', 'bottom')).toBe('down');
    expect(resolveDirection('card', 'center')).toBe('collapse');
  });
});

describe('keyframes', () => {
  it('exit runs from resting to the direction-specific gone transform', () => {
    const kf = exitKeyframes('right');
    expect(kf).toHaveLength(2);
    expect(kf[0]).toMatchObject({ opacity: 1, transform: 'none', offset: 0 });
    expect(kf[1]).toMatchObject({ opacity: 0, transform: 'translateX(24px)', offset: 1 });
    // Transform + opacity only — deliberately no `filter: blur()`. A filter on a
    // section container becomes a backdrop root and kills the frosted glass of
    // its `.stat-card`/`.param-card`/`.panel` children mid-animation.
    expect(kf[0].filter).toBeUndefined();
    expect(kf[1].filter).toBeUndefined();
  });

  it('enter is the mirror of exit — from gone back to resting', () => {
    const kf = enterKeyframes('left');
    expect(kf[0]).toMatchObject({ opacity: 0, transform: 'translateX(-24px)', offset: 0 });
    expect(kf[1]).toMatchObject({ opacity: 1, transform: 'none', offset: 1 });
  });

  it('maps every direction to its own gone transform', () => {
    // A section leaves and returns along the same line, so exit[1] and enter[0]
    // must carry the same transform for a given direction.
    const cases = {
      right: 'translateX(24px)',
      left: 'translateX(-24px)',
      up: 'translateY(-14px)',
      down: 'translateY(18px)',
      collapse: 'scale(0.985) translateY(10px)',
    };
    for (const [dir, transform] of Object.entries(cases)) {
      expect(exitKeyframes(dir)[1].transform).toBe(transform);
      expect(enterKeyframes(dir)[0].transform).toBe(transform);
    }
  });

  it('an unknown direction falls back to collapse', () => {
    expect(exitKeyframes('sideways')[1].transform).toBe('scale(0.985) translateY(10px)');
  });
});

describe('microKind', () => {
  it('recognises buttons', () => {
    expect(microKind({ tagName: 'BUTTON' })).toBe('button');
    expect(microKind({ tagName: 'A', role: 'button' })).toBe('button');
    expect(microKind({ tagName: 'A', className: 'btn' })).toBe('button');
  });

  it('recognises fields', () => {
    expect(microKind({ tagName: 'INPUT' })).toBe('field');
    expect(microKind({ tagName: 'SELECT' })).toBe('field');
    expect(microKind({ tagName: 'TEXTAREA' })).toBe('field');
    expect(microKind({ tagName: 'DIV', className: 'field' })).toBe('field');
  });

  it('returns null for anything else', () => {
    expect(microKind({ tagName: 'DIV', className: 'card' })).toBeNull();
    expect(microKind({})).toBeNull();
  });
});

describe('microKeyframes', () => {
  it('buttons pop from a slight scale', () => {
    const kf = microKeyframes('button');
    expect(kf[0]).toMatchObject({ opacity: 0, transform: 'scale(0.9)' });
    expect(kf[1]).toMatchObject({ opacity: 1, transform: 'none' });
  });

  it('fields rise from below (the default)', () => {
    const kf = microKeyframes('field');
    expect(kf[0]).toMatchObject({ opacity: 0, transform: 'translateY(8px)' });
    expect(kf[1]).toMatchObject({ opacity: 1, transform: 'none' });
  });
});

describe('timing', () => {
  it('exit stagger grows then caps at maxStep', () => {
    expect(exitDelay(0)).toBe(0);
    expect(exitDelay(1)).toBe(MOTION.exit.stagger);
    expect(exitDelay(MOTION.exit.maxStep)).toBe(MOTION.exit.maxStep * MOTION.exit.stagger);
    // Past the cap the delay no longer grows.
    expect(exitDelay(MOTION.exit.maxStep + 5)).toBe(exitDelay(MOTION.exit.maxStep));
  });

  it('enter stagger grows then caps at maxStep', () => {
    expect(enterDelay(0)).toBe(0);
    expect(enterDelay(2)).toBe(2 * MOTION.enter.stagger);
    expect(enterDelay(MOTION.enter.maxStep + 3)).toBe(
      MOTION.enter.maxStep * MOTION.enter.stagger,
    );
  });

  it('exitBudget covers the last section start plus its duration and slack', () => {
    // count=1 → only section 0, no stagger.
    expect(exitBudget(1)).toBe(MOTION.exit.duration + 80);
    // count=3 → last section is order 2.
    expect(exitBudget(3)).toBe(MOTION.exit.duration + exitDelay(2) + 80);
    // Degenerate counts don't produce a negative order.
    expect(exitBudget(0)).toBe(MOTION.exit.duration + exitDelay(0) + 80);
  });
});
