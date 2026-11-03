// Locale-aware formatting for the bilingual UI, plus the Jalali conversion
// helpers the date picker needs. Display dates render Gregorian in English
// and Jalali (Persian calendar, Persian digits) in Persian — the browser's
// own Intl does the calendar work; jalaali-js is only needed to parse typed
// Jalali input back into an ISO date. Stored dates are ALWAYS ISO Gregorian;
// nothing here changes what the server keeps.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isValidJalaaliDate, toGregorian, toJalaali } from 'jalaali-js';

// The institution runs on the Jalali calendar, so "this month" starts at 1
// of the current Jalali month; ranges sent to the server stay ISO Gregorian.
export function startOfJalaliMonth(date) {
  const { jy, jm } = toJalaali(date);
  const { gy, gm, gd } = toGregorian(jy, jm, 1);
  return new Date(gy, gm - 1, gd);
}

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

// Reuse the expensive ICU formatters across table/picker rows and rerenders.
const bothDateFormats = {
  en: new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric' }),
  fa: new Intl.DateTimeFormat('fa-IR-u-ca-persian', { day: 'numeric', month: 'long', year: 'numeric' }),
};
const numberFormats = {
  en: new Intl.NumberFormat('en'),
  fa: new Intl.NumberFormat('fa-IR'),
};

export function toPersianDigits(text) {
  return String(text).replace(/[0-9]/g, (digit) => PERSIAN_DIGITS[Number(digit)]);
}

// Inputs may arrive with Persian or Arabic-Indic digits (keyboard layouts
// produce either); everything submitted to the server must be Latin.
export function toLatinDigits(text) {
  return String(text)
    .replace(/[۰-۹]/g, (digit) => String(PERSIAN_DIGITS.indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String(ARABIC_DIGITS.indexOf(digit)));
}

function localDateFromIso(isoDate) {
  const text =
    isoDate instanceof Date
      ? isoDate.toISOString().slice(0, 10)
      : String(isoDate ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const [year, month, day] = text.split('-').map(Number);
  if (year === 0) return null;
  // The multi-argument Date constructor silently shifts years 0–99 to 1900–1999.
  const date = new Date(0);
  date.setHours(0, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function isoFromLocalDate(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// A full date with weekday, e.g. «یکشنبه ۳ آبان ۱۴۰۵» / 'Sun, Oct 25, 2026'.
export function formatLocaleDate(isoDate, language, options) {
  const date = localDateFromIso(isoDate);
  if (!date) return '—';
  const locale =
    language === 'en' ? 'en' : 'fa-IR-u-ca-persian';
  return new Intl.DateTimeFormat(
    locale,
    options ?? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }
  ).format(date);
}

// A compact date without weekday/year context.
export function formatLocaleShortDate(isoDate, language) {
  return formatLocaleDate(isoDate, language, { day: 'numeric', month: 'short' });
}

export function formatLocaleNumber(value, language) {
  return numberFormats[language === 'en' ? 'en' : 'fa'].format(value);
}

// Both calendars side by side (the institution runs on Jalali, the data on
// Gregorian): the active language's calendar first, the other in brackets
// with Latin digits so either reader can pin the exact day.
export function formatBothDates(isoDate, language) {
  const date = localDateFromIso(isoDate);
  if (!date) return '—';
  const gregorian = bothDateFormats.en.format(date);
  const jalali = bothDateFormats.fa.format(date);
  return language === 'en' ? `${gregorian} (${jalali})` : `${jalali} (${gregorian})`;
}

// --- Jalali text ⇄ ISO, for the date picker's Persian field -----------------

export function jalaliTextFromIso(isoDate) {
  const date = localDateFromIso(isoDate);
  if (!date) return '';
  let parts;
  try { parts = toJalaali(date); } catch { return ''; }
  const { jy, jm, jd } = parts;
  const pad = (n) => String(n).padStart(2, '0');
  return toPersianDigits(`${jy}/${pad(jm)}/${pad(jd)}`);
}

// Accepts Persian or Latin digits and / - . or space separators, e.g.
// '۱۴۰۵/۰۸/۰۳' or '1405-8-3'. Returns an ISO date, or null when the text is
// not a real Jalali date.
export function isoFromJalaliText(text) {
  const match = toLatinDigits(text).trim().match(/^(\d{1,4})[/ .-](\d{1,2})[/ .-](\d{1,2})$/);
  if (!match) return null;
  const [jy, jm, jd] = match.slice(1).map(Number);
  if (!isValidJalaaliDate(jy, jm, jd)) return null;
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return isoFromLocalDate(new Date(gy, gm - 1, gd));
}

// The page-facing API: language-bound formatters that re-render on switch.
export function useLocale() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage === 'en' ? 'en' : 'fa';
  return useMemo(
    () => ({
      language,
      isRtl: language === 'fa',
      date: (isoDate, options) => formatLocaleDate(isoDate, language, options),
      shortDate: (isoDate) => formatLocaleShortDate(isoDate, language),
      number: (value) => formatLocaleNumber(value, language),
      bothDates: (isoDate) => formatBothDates(isoDate, language),
    }),
    [language]
  );
}
