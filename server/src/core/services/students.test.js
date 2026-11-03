// Service-layer test for students — runs the real service functions against a
// fresh in-memory PGlite (the test service adapter), so it
// exercises the exact code path: validation -> SQL -> PGlite -> shaped result.
//
//   node --test src/core/services/students.test.js
//
// Each test gets its own in-memory database (migrations are fast on PGlite), so
// there is no cross-test state to reason about.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { studentIdentity } from '../../../test/fixtures/identity.js';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import {
  createStudent,
  listStudents,
  getStudent,
  updateStudent,
  deleteStudent,
  importStudents,
} from './students.js';

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

// Assert a service call rejects with a ServiceError of the expected code.
async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('create returns a student with a generated code and uuid', async () => {
  const pool = await freshDb();
  try {
    const student = await createStudent({ ...studentIdentity(), fullName: '  Ada   Lovelace ' });
    assert.match(student.id, /^[0-9a-f-]{36}$/i);
    assert.equal(student.fullName, 'Ada Lovelace'); // normalised whitespace
    assert.match(student.studentCode, /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
    assert.ok(student.createdAt);
    assert.deepEqual(student.extra, {});
  } finally {
    await pool.end();
  }
});

test('create rejects an invalid name with VALIDATION', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => createStudent({ fullName: 'x' }));
    await expectCode('VALIDATION', () => createStudent({}));
  } finally {
    await pool.end();
  }
});

test('get / update / soft-delete round-trip', async () => {
  const pool = await freshDb();
  try {
    const created = await createStudent({ ...studentIdentity(), fullName: 'Grace Hopper' });

    const fetched = await getStudent(created.id);
    assert.equal(fetched.id, created.id);

    const renamed = await updateStudent(created.id, { fullName: 'Grace B. Hopper' });
    assert.equal(renamed.fullName, 'Grace B. Hopper');
    assert.equal(renamed.studentCode, created.studentCode); // code immutable

    await deleteStudent(created.id);
    await expectCode('NOT_FOUND', () => getStudent(created.id));
    await expectCode('NOT_FOUND', () => deleteStudent(created.id)); // already gone
  } finally {
    await pool.end();
  }
});

test('immutable code and empty update are rejected', async () => {
  const pool = await freshDb();
  try {
    const created = await createStudent({ ...studentIdentity(), fullName: 'Alan Turing' });
    await expectCode('VALIDATION', () =>
      updateStudent(created.id, { studentCode: 'AAAAAAAA' }),
    );
    await expectCode('VALIDATION', () => updateStudent(created.id, {}));
  } finally {
    await pool.end();
  }
});

test('malformed id reads as NOT_FOUND, not a crash', async () => {
  const pool = await freshDb();
  try {
    await expectCode('NOT_FOUND', () => getStudent('not-a-uuid'));
    await expectCode('NOT_FOUND', () => updateStudent('nope', { fullName: 'X Y' }));
  } finally {
    await pool.end();
  }
});

test('list supports search, sort and paging', async () => {
  const pool = await freshDb();
  try {
    await createStudent({ ...studentIdentity(), fullName: 'Katherine Johnson' });
    await createStudent({ ...studentIdentity(), fullName: 'Dorothy Vaughan' });
    const mary = await createStudent({ ...studentIdentity(), fullName: 'Mary Jackson' });

    const all = await listStudents({ sort: 'name' });
    assert.equal(all.total, 3);
    assert.deepEqual(
      all.students.map((s) => s.fullName),
      ['Dorothy Vaughan', 'Katherine Johnson', 'Mary Jackson'],
    );

    const byName = await listStudents({ search: 'dorothy' });
    assert.equal(byName.total, 1);
    assert.equal(byName.students[0].fullName, 'Dorothy Vaughan');

    const byCode = await listStudents({ search: mary.studentCode });
    assert.equal(byCode.total, 1);
    assert.equal(byCode.students[0].id, mary.id);

    const firstPage = await listStudents({ pageSize: 2, sort: 'name' });
    assert.equal(firstPage.students.length, 2);
    assert.equal(firstPage.total, 3);

    await expectCode('VALIDATION', () => listStudents({ sort: 'bogus' }));
    await expectCode('VALIDATION', () => listStudents({ groupId: 'nope' }));
  } finally {
    await pool.end();
  }
});

test('custom extra fields validate, persist and clear', async () => {
  const pool = await freshDb();
  try {
    // Seed a live text field definition directly.
    const def = await pool.query(
      `INSERT INTO student_field_definitions (label, field_type)
       VALUES ('Nickname', 'text') RETURNING id`,
    );
    const fieldId = def.rows[0].id;

    const created = await createStudent({
      ...studentIdentity(),
      fullName: 'Edsger Dijkstra',
      extra: { [fieldId]: 'Eddie' },
    });
    assert.equal(created.extra[fieldId], 'Eddie');

    // Unknown field id is rejected.
    await expectCode('VALIDATION', () =>
      createStudent({ ...studentIdentity(), fullName: 'Some One', extra: { 'bad-id': 'x' } }),
    );

    // Clearing: sending the key as '' removes it.
    const cleared = await updateStudent(created.id, { extra: { [fieldId]: '' } });
    assert.equal(fieldId in cleared.extra, false);
  } finally {
    await pool.end();
  }
});

test('import dry-run classifies without writing; real run inserts + audits', async () => {
  const pool = await freshDb();
  try {
    const rows = [
      { ...studentIdentity(), row: 1, fullName: 'Barbara Liskov' },
      { ...studentIdentity(), row: 2, fullName: 'Barbara Liskov' }, // duplicate within the file
      { ...studentIdentity(), row: 3, fullName: 'x' }, // invalid
    ];

    const dry = await importStudents({ rows, dryRun: true });
    assert.equal(dry.dryRun, true);
    assert.equal(dry.counts.total, 3);
    assert.equal(dry.counts.willImport, 1);
    assert.equal(dry.counts.invalid, 1);
    assert.equal((await listStudents({})).total, 0); // nothing written

    const real = await importStudents({ rows, dryRun: false });
    assert.equal(real.dryRun, false);
    assert.equal(real.created.length, 1);
    assert.equal((await listStudents({})).total, 1);

    const audit = await pool.query(
      `SELECT actor, action FROM audit_log WHERE action = 'student.import'`,
    );
    assert.equal(audit.rowCount, 1);
    assert.equal(audit.rows[0].actor, 'local');
  } finally {
    await pool.end();
  }
});
