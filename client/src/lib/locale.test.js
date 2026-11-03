import { describe, expect, it } from 'vitest';
import {
  formatBothDates,
  formatLocaleDate,
  formatLocaleNumber,
  isoFromJalaliText,
  jalaliTextFromIso,
  toLatinDigits,
  toPersianDigits,
} from './locale.js';

describe('digits', () => {
  it('converts Persian and Arabic-Indic digits to Latin', () => {
    expect(toLatinDigits('۱۴۰۵/۰۸/۰۳')).toBe('1405/08/03');
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(toLatinDigits('already-42')).toBe('already-42');
  });

  it('converts Latin digits to Persian', () => {
    expect(toPersianDigits('1405')).toBe('۱۴۰۵');
  });
});

describe('dates', () => {
  it('renders the Persian calendar with Persian digits for fa', () => {
    // 2026-10-25 = 3 Aban 1405.
    expect(formatLocaleDate('2026-10-25', 'fa')).toContain('۱۴۰۵');
    expect(formatLocaleDate('2026-10-25', 'fa')).toContain('آبان');
  });

  it('renders Gregorian for en', () => {
    expect(formatLocaleDate('2026-10-25', 'en')).toContain('2026');
  });

  it('renders early birth years without shifting centuries and rejects invalid dates', () => {
    expect(formatBothDates('0099-01-01', 'en')).toMatch(/^Jan 1, 99 \(/);
    expect(formatLocaleDate('0004-02-29', 'en')).toContain('Feb 29, 4');
    expect(formatBothDates('0099-02-29', 'en')).toBe('—');
    expect(formatBothDates('0000-01-01', 'fa')).toBe('—');
  });

  it('shows both calendars side by side, active language first', () => {
    const fa = formatBothDates('2026-10-25', 'fa');
    expect(fa).toContain('۱۴۰۵');
    expect(fa).toContain('2026');
    expect(fa.indexOf('۱۴۰۵')).toBeLessThan(fa.indexOf('2026'));
    const en = formatBothDates('2026-10-25', 'en');
    expect(en.indexOf('2026')).toBeLessThan(en.indexOf('۱۴۰۵'));
  });

  it('accepts defensive Date/full-ISO inputs without crashing', () => {
    expect(formatBothDates('2026-10-25T20:30:00.000Z', 'en')).toContain('2026');
    expect(formatBothDates(new Date('2026-10-25T00:00:00.000Z'), 'en')).toContain('2026');
    expect(formatBothDates('not-a-date', 'fa')).toBe('—');
  });

  it('round-trips Jalali picker text through ISO', () => {
    expect(isoFromJalaliText('۱۴۰۵/۰۸/۰۳')).toBe('2026-10-25');
    expect(isoFromJalaliText('1405-8-3')).toBe('2026-10-25');
    expect(jalaliTextFromIso('2026-10-25')).toBe('۱۴۰۵/۰۸/۰۳');
  });

  it('rejects impossible Jalali dates', () => {
    // Esfand 30 only exists in leap years; 1405 is not one.
    expect(isoFromJalaliText('1405/12/30')).toBeNull();
    expect(isoFromJalaliText('not a date')).toBeNull();
    expect(isoFromJalaliText('1405/13/01')).toBeNull();
  });
});

describe('numbers', () => {
  it('formats with Persian digits and separators for fa', () => {
    expect(formatLocaleNumber(1234567, 'fa')).toBe('۱٬۲۳۴٬۵۶۷');
    expect(formatLocaleNumber(1234567, 'en')).toBe('1,234,567');
  });
});
