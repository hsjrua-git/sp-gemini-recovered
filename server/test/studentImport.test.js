import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRequest } from '../src/lib/auditRules.js';
import {
  MAX_IMPORT_ROWS,
  classifyImportRows,
  importCounts,
  nameKey,
  validateImportBody,
} from '../src/lib/studentImport.js';

const identity = n => ({ gender: 'female', birthDate: '2000-01-01', fatherName: 'Test Father', nationalId: String(1000000000 + n) });
const row = (n, fullName) => ({ row: n, fullName, ...identity(n) });
const none = new Map();

test('a valid import request gets its defaults', () => {
  assert.deepEqual(validateImportBody({ rows: [row(2, 'Ana Souza')] }), {
    rows: [row(2, 'Ana Souza')],
    allowDuplicateNames: false,
    dryRun: false,
  });
  assert.deepEqual(
    validateImportBody({ rows: [row(1, 'Ana')], dryRun: true, allowDuplicateNames: true }),
    { rows: [row(1, 'Ana')], allowDuplicateNames: true, dryRun: true }
  );
});

test('bad import requests are refused', () => {
  assert.ok(validateImportBody(null).error);
  assert.ok(validateImportBody([]).error);
  assert.ok(validateImportBody({ rows: [] }).error);
  assert.ok(validateImportBody({ rows: 'x' }).error);
  assert.ok(validateImportBody({ rows: [{ row: 0, fullName: 'Ana' }] }).error);
  assert.ok(validateImportBody({ rows: [{ row: 1.5, fullName: 'Ana' }] }).error);
  assert.ok(validateImportBody({ rows: [{ row: 1 }] }).error);
  assert.ok(validateImportBody({ rows: [null] }).error);
  assert.ok(validateImportBody({ rows: [row(1, 'Ana'), row(1, 'Ben')] }).error);
  assert.ok(validateImportBody({ rows: [row(1, 'Ana')], dryRun: 'yes' }).error);

  const tooMany = Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) =>
    row(i + 1, `Name ${i}`)
  );
  assert.ok(validateImportBody({ rows: tooMany }).error);
  assert.equal(
    validateImportBody({ rows: tooMany.slice(0, MAX_IMPORT_ROWS) }).error,
    undefined
  );
});

test('valid rows are ok, and names are tidied', () => {
  const [item] = classifyImportRows({
    rows: [row(2, '  Ana    Souza ')],
    existing: none,
    allowDuplicateNames: false,
  });
  assert.deepEqual(item, {
    ...identity(2),
    row: 2,
    fullName: 'Ana Souza',
    status: 'ok',
    message: '',
    existingCode: null,
    willImport: true,
  });
});

test('invalid names are reported and never imported', () => {
  const items = classifyImportRows({
    rows: [row(3, 'X'), row(4, '   '), row(5, 'y'.repeat(101))],
    existing: none,
    allowDuplicateNames: true,
  });
  assert.deepEqual(
    items.map((item) => [item.row, item.status, item.willImport]),
    [
      [3, 'invalid', false],
      [4, 'invalid', false],
      [5, 'invalid', false],
    ]
  );
  assert.ok(items[0].message);
});

test('names that already exist are skipped, ignoring case', () => {
  const existing = new Map([[nameKey('María López'), 'K7M2QX9A']]);
  const [item] = classifyImportRows({
    rows: [row(2, 'MARÍA  LÓPEZ')],
    existing,
    allowDuplicateNames: false,
  });
  assert.equal(item.status, 'duplicate_existing');
  assert.equal(item.existingCode, 'K7M2QX9A');
  assert.equal(item.willImport, false);
});

test('a repeated name in the file is flagged from its second appearance', () => {
  const items = classifyImportRows({
    rows: [row(2, 'Ana Souza'), row(3, 'ana souza'), row(4, 'Ben Ortiz')],
    existing: none,
    allowDuplicateNames: false,
  });
  assert.deepEqual(
    items.map((item) => [item.row, item.status, item.willImport]),
    [
      [2, 'ok', true],
      [3, 'duplicate_in_file', false],
      [4, 'ok', true],
    ]
  );
  assert.equal(items[1].message, 'Same name as row 2.');
});

test('duplicates are imported when explicitly allowed', () => {
  const existing = new Map([[nameKey('Ana Souza'), 'K7M2QX9A']]);
  const items = classifyImportRows({
    rows: [row(2, 'Ana Souza'), row(3, 'Ana Souza')],
    existing,
    allowDuplicateNames: true,
  });
  assert.deepEqual(
    items.map((item) => [item.status, item.willImport]),
    [
      ['duplicate_existing', true],
      ['duplicate_existing', true],
    ]
  );
  assert.deepEqual(importCounts(items), {
    total: 2,
    willImport: 2,
    invalid: 0,
    duplicates: 2,
    skipped: 0,
  });
});

test('counts summarise what will happen', () => {
  const items = classifyImportRows({
    rows: [row(2, 'Ana Souza'), row(3, 'Ana Souza'), row(4, 'X'), row(5, 'Ben Ortiz')],
    existing: none,
    allowDuplicateNames: false,
  });
  assert.deepEqual(importCounts(items), {
    total: 4,
    willImport: 2,
    invalid: 1,
    duplicates: 1,
    skipped: 2,
  });
});

test('names with combined or separate accents compare equal', () => {
  assert.equal(nameKey('Zoe\u0308 M'), nameKey('Zo\u00EB m'));
  assert.equal(nameKey('ÉLODIE'), nameKey('élodie'));
});

test('imports write their own audit entry, so the generic log skips them', () => {
  assert.equal(classifyRequest('POST', '/api/students/import', 200), null);
  assert.equal(classifyRequest('POST', '/api/students/import', 201), null);
  assert.equal(
    classifyRequest('POST', '/api/students', 201).action,
    'student.create'
  );
});
