import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { setLanguage } from '../i18n/index.js';
import { jalaliTextFromIso } from '../lib/locale.js';
import JalaliDatePicker from './JalaliDatePicker.jsx';

function Field(props) {
  const [value, setValue] = useState('2026-10-30');
  return <form aria-label="Dates"><JalaliDatePicker value={value} onChange={setValue} {...props} /></form>;
}
beforeEach(() => setLanguage('en'));

test('invalid Jalali draft survives blur and blocks submission until corrected', () => {
  render(<Field />);
  const text = screen.getByRole('textbox', { name: 'Jalali' });
  fireEvent.change(text, { target: { value: '1405/13/40' } });
  fireEvent.blur(text);
  expect(text.value).toBe('1405/13/40');
  expect(text.getAttribute('aria-invalid')).toBe('true');
  expect(screen.getByRole('form').checkValidity()).toBe(false);
  expect(document.querySelector('input[type=date]').value).toBe('');
  fireEvent.change(text, { target: { value: '1405/08/08' } });
  expect(document.querySelector('input[type=date]').value).toBe('2026-10-30');
  expect(screen.getByRole('form').checkValidity()).toBe(true);
});

test('calendar selection respects bounds and Escape returns focus to its toggle', () => {
  render(<Field min="2026-10-01" max="2026-10-30" />);
  const toggle = screen.getByRole('button', { name: /shamsi/i });
  fireEvent.click(toggle);
  const selected = document.querySelector('[data-date="2026-10-30"]');
  expect(selected.disabled).toBe(false);
  expect(document.querySelector('[data-date="2026-10-31"]').disabled).toBe(true);
  fireEvent.keyDown(selected, { key: 'ArrowLeft' });
  expect(document.activeElement.dataset.date).toBe('2026-10-29');
  fireEvent.click(document.activeElement);
  expect(document.querySelector('input[type=date]').value).toBe('2026-10-29');
  fireEvent.click(toggle);
  fireEvent.keyDown(document.activeElement, { key: 'Escape' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(document.activeElement).toBe(toggle);
});

test('dates outside the conversion library range never crash rendering', () => {
  expect(jalaliTextFromIso('9999-12-31')).toBe('');
  render(<JalaliDatePicker value="9999-12-31" onChange={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /shamsi/i }));
  expect(document.querySelector('.shamsi-calendar')).not.toBeNull();
});

test('Gregorian birth dates outside the Jalali calendar range remain editable', () => {
  render(<Field required />);
  const gregorian = document.querySelector('input[type=date]');
  fireEvent.change(gregorian, { target: { value: '0099-01-05' } });
  expect(gregorian.value).toBe('0099-01-05');
  expect(screen.getByRole('form').checkValidity()).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /shamsi/i }));
  expect(document.querySelector('.shamsi-calendar')).not.toBeNull();
  expect(gregorian.value).toBe('0099-01-05');
});
