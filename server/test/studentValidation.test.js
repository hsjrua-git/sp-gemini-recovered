import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBirthDate,
  normalizeFatherName,
  normalizeFullName,
  normalizeGender,
  normalizeNationalId,
} from '../src/validation/student.js';

test('full name keeps its rules', () => {
  assert.deepEqual(normalizeFullName('  Maria   Lopez '), { value: 'Maria Lopez' });
  assert.ok(normalizeFullName('x').error);
  assert.ok(normalizeFullName(42).error);
});

test('gender accepts the two values and rejects missing identity', () => {
  assert.deepEqual(normalizeGender('male'), { value: 'male' });
  assert.deepEqual(normalizeGender('female'), { value: 'female' });
  assert.ok(normalizeGender('').error);
  assert.ok(normalizeGender(undefined).error);
  assert.ok(normalizeGender('other').error);
});

test('birth date must be a real, past ISO date', () => {
  assert.deepEqual(normalizeBirthDate('2005-06-30'), { value: '2005-06-30' });
  assert.ok(normalizeBirthDate(null).error);
  assert.deepEqual(normalizeBirthDate('0099-01-01'), { value: '0099-01-01' });
  assert.ok(normalizeBirthDate('2005-02-30').error, 'invalid calendar day');
  assert.ok(normalizeBirthDate('30/06/2005').error, 'non-ISO format');
  assert.ok(normalizeBirthDate('2999-01-01').error, 'in the future');
});

test('father name is required text with a length range', () => {
  assert.deepEqual(normalizeFatherName(' Ali  Reza '), { value: 'Ali Reza' });
  assert.ok(normalizeFatherName('').error);
  assert.ok(normalizeFatherName('A').error, 'single character');
  assert.ok(normalizeFatherName('x'.repeat(101)).error, 'over 100 characters');
});

test('national id must be exactly 10 digits', () => {
  assert.deepEqual(normalizeNationalId('0012345678'), { value: '0012345678' });
  assert.ok(normalizeNationalId(undefined).error);
  assert.ok(normalizeNationalId('123456789').error, 'too short');
  assert.ok(normalizeNationalId('12345678901').error, 'too long');
  assert.ok(normalizeNationalId('12345678ab').error, 'non-digits');
});
