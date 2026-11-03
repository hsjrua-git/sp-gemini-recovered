// Service-layer test for custom fields — runs the real service functions
// against a fresh in-memory PGlite, exercising validation -> SQL -> PGlite ->
// shaped result through the framework-free PGlite mirror.
//
//   node --test src/core/services/fields.test.js
//
// Each test gets its own in-memory database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import {
  listFields,
  createField,
  updateField,
  archiveField,
} from './fields.js';

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');

async function freshDb() {
  const pool = createPglitePool(); // in-memory
  await pool.ready();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  initDb(pool);
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('create returns a field with defaults and an incrementing sort order', async () => {
  const pool = await freshDb();
  try {
    const { field: first } = await createField({ label: '  Nick  Name ', fieldType: 'text' });
    assert.match(first.id, /^[0-9a-f-]{36}$/i);
    assert.equal(first.label, 'Nick Name'); // whitespace normalised
    assert.equal(first.fieldType, 'text');
    assert.deepEqual(first.choices, []);
    assert.equal(first.isRestricted, false);
    assert.equal(first.sortOrder, 1);
    assert.equal(first.archivedAt, null);

    const { field: second } = await createField({ label: 'House', fieldType: 'choice', choices: ['A', 'B'] });
    assert.equal(second.sortOrder, 2); // max(sort_order)+1
    assert.deepEqual(second.choices, ['A', 'B']);
  } finally {
    await pool.end();
  }
});

test('create validates label, type and choice requirements', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => createField({ label: '', fieldType: 'text' }));
    await expectCode('VALIDATION', () => createField({ label: 'X', fieldType: 'bogus' }));
    // a choice field with no usable choices
    await expectCode('VALIDATION', () => createField({ label: 'Y', fieldType: 'choice', choices: ['   '] }));
  } finally {
    await pool.end();
  }
});

test('duplicate label (case-insensitive) is a CONFLICT', async () => {
  const pool = await freshDb();
  try {
    await createField({ label: 'Nickname', fieldType: 'text' });
    await expectCode('CONFLICT', () => createField({ label: 'nickname', fieldType: 'text' }));
  } finally {
    await pool.end();
  }
});

test('list hides archived by default and shows restricted (single admin)', async () => {
  const pool = await freshDb();
  try {
    const { field: a } = await createField({ label: 'Secret', fieldType: 'text', isRestricted: true });
    const { field: b } = await createField({ label: 'Open', fieldType: 'text' });

    const visible = await listFields();
    assert.deepEqual(visible.fields.map((f) => f.label).sort(), ['Open', 'Secret']);
    // restricted field is returned to the single admin
    assert.equal(visible.fields.find((f) => f.id === a.id).isRestricted, true);

    await archiveField(b.id);
    const afterArchive = await listFields();
    assert.deepEqual(afterArchive.fields.map((f) => f.label), ['Secret']);

    const withArchived = await listFields({ includeArchived: true });
    assert.equal(withArchived.fields.length, 2);
  } finally {
    await pool.end();
  }
});

test('update: label / restricted / sortOrder, plus guards', async () => {
  const pool = await freshDb();
  try {
    const { field } = await createField({ label: 'Team', fieldType: 'text' });

    const { field: updated } = await updateField(field.id, {
      label: 'Squad',
      isRestricted: true,
      sortOrder: 5,
    });
    assert.equal(updated.label, 'Squad');
    assert.equal(updated.isRestricted, true);
    assert.equal(updated.sortOrder, 5);

    await expectCode('VALIDATION', () => updateField(field.id, { fieldType: 'number' }));
    await expectCode('VALIDATION', () => updateField(field.id, {}));
    await expectCode('VALIDATION', () => updateField(field.id, { isRestricted: 'yes' }));
    await expectCode('NOT_FOUND', () => updateField('not-a-uuid', { label: 'Z' }));
  } finally {
    await pool.end();
  }
});

test('update choices refuses to drop a value a student is using', async () => {
  const pool = await freshDb();
  try {
    const { field } = await createField({ label: 'House', fieldType: 'choice', choices: ['Red', 'Blue'] });
    // A text field cannot take choices.
    const { field: text } = await createField({ label: 'Note', fieldType: 'text' });
    await expectCode('VALIDATION', () => updateField(text.id, { choices: ['x'] }));

    // Park a student on the 'Red' choice.
    await pool.query(
      `INSERT INTO students (student_code, full_name, extra,gender,birth_date,father_name,national_id)
       VALUES ('ABCDEFGH', 'Grace Hopper', $1::jsonb,'female','2000-01-01','Test Father','1000000001')`,
      [JSON.stringify({ [field.id]: 'Red' })],
    );
    await expectCode('CONFLICT', () => updateField(field.id, { choices: ['Blue'] }));

    // Dropping an unused choice is fine.
    const { field: ok } = await updateField(field.id, { choices: ['Red', 'Green'] });
    assert.deepEqual(ok.choices, ['Red', 'Green']);
  } finally {
    await pool.end();
  }
});

test('archive is idempotent, frees the label, and 404s a missing field', async () => {
  const pool = await freshDb();
  try {
    const { field } = await createField({ label: 'Cohort', fieldType: 'text' });

    await archiveField(field.id); // archives
    await archiveField(field.id); // already archived — no-op success
    await expectCode('NOT_FOUND', () => archiveField('00000000-0000-4000-8000-000000000000'));

    // The partial unique index only covers live rows, so the label is reusable.
    const { field: reused } = await createField({ label: 'Cohort', fieldType: 'text' });
    assert.equal(reused.label, 'Cohort');
  } finally {
    await pool.end();
  }
});

test('create and update write audit rows attributed to the local actor', async () => {
  const pool = await freshDb();
  try {
    const { field } = await createField({ label: 'Advisor', fieldType: 'text' });
    await updateField(field.id, { label: 'Mentor' });
    await archiveField(field.id);

    const audit = await pool.query(
      `SELECT action, actor FROM audit_log
       WHERE entity_type = 'field' ORDER BY id`,
    );
    assert.deepEqual(
      audit.rows.map((r) => r.action),
      ['field.create', 'field.update', 'field.archive'],
    );
    assert.ok(audit.rows.every((r) => r.actor === 'local'));
  } finally {
    await pool.end();
  }
});
