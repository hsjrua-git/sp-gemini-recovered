import { describe, it, expect, beforeAll } from 'vitest';
import i18n from '../i18n/index.js';
import {
  describeChange,
  formatChange,
  formatIsoDate,
  formatParameterHint,
  formatRange,
  formatStudentCode,
  toIsoDate,
} from './format.js';

// The formatters render in the active UI language; the app defaults to
// Persian, so pin English for these assertions (the fa renderings are covered
// by src/i18n and src/lib/locale tests).
beforeAll(() => {
  i18n.changeLanguage('en');
});

describe('formatStudentCode', () => {
  it('splits an 8-char code into two groups of four', () => {
    expect(formatStudentCode('2024ABCD')).toBe('2024-ABCD');
  });
});

describe('toIsoDate', () => {
  it('formats a Date as YYYY-MM-DD with zero padding', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(toIsoDate(new Date('0099-01-05T12:00:00'))).toBe('0099-01-05');
  });
});

describe('formatIsoDate', () => {
  it('shows the Gregorian date with the Jalali date beside it', () => {
    const text = formatIsoDate('2026-10-25');
    expect(text).toContain('2026');
    expect(text).toContain('۱۴۰۵');
  });
});

describe('formatRange', () => {
  it('shows an em dash when both bounds are missing', () => {
    expect(formatRange({ minValue: null, maxValue: null })).toBe('—');
  });

  it('uses an ellipsis for a missing bound', () => {
    expect(formatRange({ minValue: 0, maxValue: null })).toBe('0 to …');
  });

  it('shows both bounds when present', () => {
    expect(formatRange({ minValue: 1, maxValue: 10 })).toBe('1 to 10');
  });
});

describe('formatParameterHint', () => {
  it('joins the range and unit with a middle dot', () => {
    const hint = formatParameterHint({ minValue: 0, maxValue: 20, unit: 'pts' });
    expect(hint).toBe('0 to 20 · pts');
  });

  it('omits an empty range', () => {
    const hint = formatParameterHint({
      minValue: null,
      maxValue: null,
      unit: 'pts',
    });
    expect(hint).toBe('pts');
  });
});

describe('describeChange', () => {
  it('describes an addition scoped to this period only', () => {
    expect(describeChange({ scope: 'this_period', action: 'add' })).toBe(
      'Added, this period only',
    );
  });

  it('describes a removal from this period on', () => {
    expect(describeChange({ scope: 'from_here_on', action: 'remove' })).toBe(
      'Removed, from this period on',
    );
  });
});

describe('formatChange', () => {
  it('renders an em dash for no change data', () => {
    expect(formatChange(null)).toBe('—');
  });

  it('renders a bare zero', () => {
    expect(formatChange(0)).toBe('0');
  });

  it('prefixes an up triangle for gains and down for losses', () => {
    expect(formatChange(3)).toBe('▲ 3');
    expect(formatChange(-2)).toBe('▼ 2');
  });
});
