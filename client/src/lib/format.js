import i18n from '../i18n/index.js';
import { formatBothDates, formatLocaleShortDate } from './locale.js';

// The whole app renders dates through these formatters, so locale awareness
// lives HERE rather than at every call site: Persian shows the Jalali date
// with the Gregorian in brackets (the institution runs on Jalali, the data
// on Gregorian — both stay visible), English mirrors it. Stored dates are
// never touched; only the rendering changes.
function language() {
  return i18n.resolvedLanguage === 'en' ? 'en' : 'fa';
}

export function formatStudentCode(code) {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function formatDateTime(isoString) {
  const locale = language() === 'fa' ? 'fa-IR-u-ca-persian' : undefined;
  return new Date(isoString).toLocaleString(locale);
}

function normalizeIsoDateString(isoDate) {
  if (!isoDate) return '';
  if (isoDate instanceof Date) return toIsoDate(isoDate);
  return String(isoDate).slice(0, 10);
}

export function formatIsoDate(isoDate) {
  return formatBothDates(normalizeIsoDateString(isoDate), language());
}

export function formatShortIsoDate(isoDate) {
  return formatLocaleShortDate(normalizeIsoDateString(isoDate), language());
}

export function toIsoDate(date) {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function describeChange({ scope, action }) {
  const verb = action === 'add' ? i18n.t('changes.add') : i18n.t('changes.remove');
  const tail =
    scope === 'from_here_on'
      ? i18n.t('changes.fromHereOn')
      : i18n.t('changes.thisOnly');
  return `${verb}${tail}`;
}

export function formatRange({ minValue, maxValue }) {
  if (minValue === null && maxValue === null) return '—';
  return `${minValue ?? '…'} ${i18n.t('changes.to')} ${maxValue ?? '…'}`;
}

export function formatParameterHint(parameter, dimension) {
  if (dimension === 'quality') return '0–100%';
  if (dimension === 'both') return `${i18n.t('workflows:quality')} · ${i18n.t('workflows:quantityRange')}: ${formatRange(parameter)}`;
  const range = formatRange(parameter);
  return [range === '—' ? null : range, parameter.unit]
    .filter(Boolean)
    .join(' · ');
}

export function formatChange(change) {
  if (change === null) return '—';
  if (change === 0) return '0';
  return `${change > 0 ? '▲' : '▼'} ${Math.abs(change)}`;
}
