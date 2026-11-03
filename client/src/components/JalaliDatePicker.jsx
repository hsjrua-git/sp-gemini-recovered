import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { jalaaliMonthLength, toJalaali } from 'jalaali-js';
import { isoFromJalaliText, jalaliTextFromIso, toLatinDigits } from '../lib/locale.js';

function monthOf(value) {
  const date = value ? new Date(`${value}T12:00:00`) : new Date();
  try { return toJalaali(Number.isNaN(date.getTime()) ? new Date() : date); }
  catch { return toJalaali(new Date()); }
}

const CALENDAR_MIN = isoFromJalaliText('1/1/1');
const CALENDAR_MAX = isoFromJalaliText(`3176/12/${jalaaliMonthLength(3176, 12)}`);

function ShamsiCalendar({ value, onSelect, onClose, min, max }) {
  const { t, i18n } = useTranslation('workflows');
  const [month, setMonth] = useState(() => {
    const today = monthOf();
    const candidate = value || isoFromJalaliText(`${today.jy}/${today.jm}/${today.jd}`);
    return monthOf(candidate < min ? min : candidate > max ? max : candidate);
  });
  const [focusDate, setFocusDate] = useState(isoFromJalaliText(`${month.jy}/${month.jm}/${month.jd}`));
  const root = useRef(null);
  const months = t('calendar.months', { returnObjects: true });
  const weekdays = t('calendar.days', { returnObjects: true });
  const firstIso = isoFromJalaliText(`${month.jy}/${month.jm}/1`);
  const offset = (new Date(`${firstIso}T12:00:00`).getDay() + 1) % 7;
  const number = n => new Intl.NumberFormat(i18n.resolvedLanguage === 'en' ? 'en' : 'fa', { useGrouping: false }).format(n);
  const permitted = iso => iso && iso >= min && iso <= max;
  useEffect(() => { root.current?.querySelector(`[data-date="${focusDate}"]`)?.focus(); }, [focusDate]);
  function showMonth(jy, jm, focus = false) {
    if (jy < 1 || jy > 3176) return;
    const first = isoFromJalaliText(`${jy}/${jm}/1`);
    const last = isoFromJalaliText(`${jy}/${jm}/${jalaaliMonthLength(jy, jm)}`);
    if (last < min || first > max) return;
    setMonth({ jy, jm });
    if (focus) setFocusDate(first < min ? min : first);
  }
  function shiftMonth(delta) {
    const index = month.jy * 12 + month.jm - 1 + delta;
    const jy = Math.floor(index / 12), jm = index % 12 + 1;
    showMonth(jy, jm, true);
  }
  function dayKey(event, iso) {
    const rtl = i18n.dir() === 'rtl';
    const shifts = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault(); shiftMonth((event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)); return;
    }
    if (!(event.key in shifts)) return;
    event.preventDefault();
    const next = new Date(`${iso}T12:00:00`);
    next.setDate(next.getDate() + shifts[event.key]);
    const nextText = `${String(next.getFullYear()).padStart(4, '0')}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
    if (!permitted(nextText)) return;
    const parts = toJalaali(next);
    const nextIso = isoFromJalaliText(`${parts.jy}/${parts.jm}/${parts.jd}`);
    if (!permitted(nextIso)) return;
    setMonth(parts); setFocusDate(nextIso);
  }
  return <span className="shamsi-calendar" ref={root} role="group" aria-label={t('calendar.open')}>
    <span className="calendar-toolbar">
      <button type="button" onClick={() => shiftMonth(-1)} aria-label={t('calendar.previous')}>−</button>
      <select aria-label={t('calendar.month')} value={month.jm} onChange={event => showMonth(month.jy, Number(event.target.value))}>
        {months.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
      </select>
      <input aria-label={t('calendar.year')} type="number" min="1" max="3176" value={month.jy} onChange={event => {
        const jy = Number(event.target.value);
        if (Number.isInteger(jy)) showMonth(jy, month.jm);
      }} />
      <button type="button" onClick={() => shiftMonth(1)} aria-label={t('calendar.next')}>+</button>
    </span>
    <span className="calendar-days">
      {weekdays.map((name, index) => <span key={index} className="hint">{name}</span>)}
      {Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}
      {Array.from({ length: jalaaliMonthLength(month.jy, month.jm) }, (_, index) => {
        const day = index + 1;
        const iso = isoFromJalaliText(`${month.jy}/${month.jm}/${day}`);
        return <button type="button" key={iso} data-date={iso} aria-label={`${number(day)} ${months[month.jm - 1]} ${number(month.jy)}`} aria-pressed={iso === value} disabled={!permitted(iso)} onKeyDown={event => dayKey(event, iso)} onClick={() => onSelect(iso)}>{number(day)}</button>;
      })}
    </span>
    <span className="row">
      <button type="button" onClick={() => { const today = monthOf(); setMonth(today); setFocusDate(isoFromJalaliText(`${today.jy}/${today.jm}/${today.jd}`)); }}>{t('calendar.today')}</button>
      <button type="button" onClick={onClose}>{t('calendar.close')}</button>
    </span>
  </span>;
}

// A date field that accepts either calendar: a native Gregorian input plus a
// Jalali text field showing the same day (Persian digits, yyyy/mm/dd). The
// two always mirror each other; typing an impossible Jalali date is flagged
// inline and retained for correction; the committed value clears so an old date
// cannot be submitted accidentally. The controlled value stays ISO
// Gregorian ('' when empty) — exactly what the API speaks.
function JalaliDatePicker({ id, value, onChange, disabled = false, required = false, min: minimum, max: maximum }) {
  const { t } = useTranslation(['common', 'nav', 'workflows']);
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const root = useRef(null);
  const toggle = useRef(null);
  const jalaliInput = useRef(null);
  const min = minimum && minimum > CALENDAR_MIN ? minimum : CALENDAR_MIN;
  const max = maximum && maximum < CALENDAR_MAX ? maximum : CALENDAR_MAX;
  const [open, setOpen] = useState(false);
  const [jalaliDraft, setJalaliDraft] = useState(null);
  const [jalaliInvalid, setJalaliInvalid] = useState(false);

  const shown = jalaliDraft ?? (value ? jalaliTextFromIso(value) : '');
  useEffect(() => {
    jalaliInput.current?.setCustomValidity(jalaliInvalid ? t('date.invalidJalali') : '');
  }, [jalaliInvalid, t]);
  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function close() { setOpen(false); toggle.current?.focus(); }
  function choose(iso) {
    setJalaliDraft(null); setJalaliInvalid(false); onChange(iso);
  }

  function handleJalaliChange(text) {
    setJalaliDraft(text);
    if (text.trim() === '') {
      setJalaliInvalid(false);
      onChange('');
      setJalaliDraft(null);
      return;
    }
    const iso = isoFromJalaliText(text);
    if (iso === null || (minimum && iso < minimum) || (maximum && iso > maximum)) {
      setJalaliInvalid(true);
      onChange('');
      return;
    }
    setJalaliInvalid(false);
    onChange(iso);
    setJalaliDraft(null);
  }

  return (
    <span className="jalali-date-picker" ref={root} onKeyDown={event => {
      if (event.key === 'Escape' && open) { event.stopPropagation(); close(); }
    }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <input
        id={inputId}
        type="date"
        value={value ?? ''}
        onChange={(event) => choose(event.target.value)}
        disabled={disabled}
        required={required}
        min={minimum}
        max={maximum}
        aria-label={t('date.gregorian')}
      />
      <input
        ref={jalaliInput}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={shown}
        onChange={(event) => handleJalaliChange(toLatinDigits(event.target.value))}
        onFocus={() => setJalaliDraft(shown)}
        onBlur={() => { if (!jalaliInvalid) setJalaliDraft(null); }}
        placeholder={t('date.jalaliPlaceholder')}
        aria-label={t('date.jalali')}
        aria-invalid={jalaliInvalid || undefined}
        disabled={disabled}
      />
      <button type="button" ref={toggle} aria-expanded={open && !disabled} aria-controls={`${inputId}-calendar`} onClick={() => setOpen(current => !current)} disabled={disabled}>{t('workflows:calendar.open')}</button>
      {open && !disabled && <span id={`${inputId}-calendar`}><ShamsiCalendar value={value} min={min} max={max} onSelect={iso => { choose(iso); close(); }} onClose={close} /></span>}
      {jalaliInvalid && (
        <span className="error" role="alert">
          {t('date.invalidJalali')}
        </span>
      )}
    </span>
  );
}

export default JalaliDatePicker;
