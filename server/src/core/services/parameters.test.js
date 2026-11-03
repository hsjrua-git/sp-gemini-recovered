// Service-layer test for parameters — real service functions against a fresh
// in-memory PGlite.
//
//   node --test src/core/services/parameters.test.js
//
// Each test gets its own in-memory database. Under the schema-4 model a
// parameter is identified by a NOT NULL unique code, its bounds are integers
// shared by both dimensions, and the period-scoped change log is gone; what
// remains is list/create/update with the range-lock guardrail and audit
// snapshots.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import {
  listParameters,
  createParameter,
  updateParameter,
} from './parameters.js';

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
  resetLocalUser(); // audit tolerates a null user id; no seeded user needed
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('createParameter: validates, mints the sort order, and audits', async () => {
  const pool = await freshDb();
  try {
    // Validation: code and name are required.
    await expectCode('VALIDATION', () => createParameter({ name: 'No code' }));
    await expectCode('VALIDATION', () => createParameter({ code: 'f', name: '' }));

    const first = await createParameter({
      code: 'focus',
      name: 'Focus',
      minValue: 0,
      maxValue: 10,
    });
    assert.equal(first.code, 'focus');
    assert.equal(first.sortOrder, 1);
    assert.equal(first.archivedAt, null);

    const second = await createParameter({ code: 'speed', name: 'Speed' });
    assert.equal(second.sortOrder, 2); // auto-incremented
    assert.equal(second.minValue, null); // open bounds are allowed

    // Unique violations on name OR code read as a conflict.
    await expectCode('CONFLICT', () =>
      createParameter({ code: 'other', name: 'Focus' })
    );
    await expectCode('CONFLICT', () =>
      createParameter({ code: 'focus', name: 'Other' })
    );

    // min above max is a DB check → a friendly validation error.
    await expectCode('VALIDATION', () =>
      createParameter({ code: 'back', name: 'Backwards', minValue: 10, maxValue: 0 })
    );

    const audit = await pool.query(
      "SELECT action, entity_id AS \"entityId\", new_data AS \"newData\" FROM audit_log WHERE action = 'parameter.create' AND details->>'source' IS DISTINCT FROM 'database' ORDER BY id"
    );
    assert.equal(audit.rows.length, 2);
    assert.equal(audit.rows[0].entityId, first.id);
    assert.equal(audit.rows[0].newData.code, 'focus');
  } finally {
    await pool.end();
  }
});

test('listParameters: active only by default, archived on request', async () => {
  const pool = await freshDb();
  try {
    const p = await createParameter({ code: 'focus', name: 'Focus' });
    await updateParameter(p.id, { archived: true });
    await createParameter({ code: 'speed', name: 'Speed' });

    const active = await listParameters();
    assert.deepEqual(active.parameters.map((row) => row.code), ['speed']);

    const all = await listParameters({ includeArchived: true });
    assert.equal(all.parameters.length, 2);
    assert.ok(all.parameters.find((row) => row.code === 'focus').archivedAt);
  } finally {
    await pool.end();
  }
});

test('updateParameter: guards, snapshots, and the range lock', async () => {
  const pool = await freshDb();
  try {
    const p = await createParameter({
      code: 'focus',
      name: 'Focus',
      minValue: 0,
      maxValue: 10,
    });

    // A recorded evaluation sits at 9 — inside [0, 10] but outside any
    // narrowing attempt.
    const teacher = (
      await pool.query(
        `INSERT INTO teachers (code, full_name, birth_date, national_id)
         VALUES ('T1000001', 'Ms. Tester', '1990-05-01', '0012345678') RETURNING id`
      )
    ).rows[0].id;
    const interval = (
      await pool.query(
        `INSERT INTO intervals (name, every) VALUES ('w', '7 days') RETURNING id`
      )
    ).rows[0].id;
    const group = (
      await pool.query(
        `INSERT INTO student_groups (name, code) VALUES ('G', 'GA') RETURNING id`
      )
    ).rows[0].id;
    const assignmentId = (
      await pool.query(
        `INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
         VALUES ('A1', $1, $2, $3, '2024-01-06') RETURNING id`,
        [teacher, interval, group]
      )
    ).rows[0].id;
    const session = (
      await pool.query(
        `INSERT INTO sessions (assignment_id, seq, code, planned_date)
         VALUES ($1, 1, 'S1', '2024-01-06') RETURNING id`,
        [assignmentId]
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO evaluations (session_id, parameter_id, membership_id, quantity_value, locks_at)
       VALUES ($1, $2, NULL, 9, now() + interval '7 days')`,
      [session, p.id]
    );

    await expectCode('VALIDATION', () => updateParameter(p.id, {}));
    await expectCode('NOT_FOUND', () =>
      updateParameter(crypto.randomUUID(), { name: 'x' })
    );
    await expectCode('VALIDATION', () =>
      updateParameter(p.id, { archived: 'yes' })
    );

    // Narrowing below the recorded 9 is refused before the write.
    await expectCode('CONFLICT', () =>
      updateParameter(p.id, { minValue: 2, maxValue: 8 })
    );

    // A rename + widen works and snapshots old vs new.
    const updated = await updateParameter(p.id, {
      name: 'Focus renamed',
      maxValue: 12,
    });
    assert.equal(updated.name, 'Focus renamed');
    assert.equal(updated.maxValue, 12);

    const audit = (
      await pool.query(
        "SELECT old_data AS \"oldData\", new_data AS \"newData\" FROM audit_log WHERE action = 'parameter.update' AND details->>'source' IS DISTINCT FROM 'database'"
      )
    ).rows[0];
    assert.equal(audit.oldData.name, 'Focus');
    assert.equal(audit.newData.name, 'Focus renamed');
    assert.equal(audit.oldData.maxValue, 10);
    assert.equal(audit.newData.maxValue, 12);

    // Archiving works; un-archiving restores.
    const archived = await updateParameter(p.id, { archived: true });
    assert.ok(archived.archivedAt);
    const restored = await updateParameter(p.id, { archived: false });
    assert.equal(restored.archivedAt, null);
  } finally {
    await pool.end();
  }
});
