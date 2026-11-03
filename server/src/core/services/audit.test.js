// Service-layer test for the audit-log reader — real service functions against
// a fresh in-memory PGlite.
//
//   node --test src/core/services/audit.test.js
//
// Audit rows are produced the way the app produces them: by calling a mutating
// service (createGroup records a 'group.create' row). ensureLocalUser() gives a
// stable 'local' actor to filter on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { ensureLocalUser } from '../bootstrap.js';
import { getAuditEntries } from './audit.js';
import { createGroup } from './groups.js';

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
  resetLocalUser();
  await ensureLocalUser(pool);
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

test('getAuditEntries: validates the category and actor filters', async () => {
  const pool = await freshDb();
  try {
    await expectCode('VALIDATION', () => getAuditEntries({ category: 'nope' }));
    await expectCode('VALIDATION', () => getAuditEntries({ actor: '' }));
    await expectCode('VALIDATION', () =>
      getAuditEntries({ actor: 'x'.repeat(65) }),
    );
  } finally {
    await pool.end();
  }
});

test('getAuditEntries: reads recorded rows, newest first, paginated', async () => {
  const pool = await freshDb();
  try {
    // No activity yet.
    const empty = await getAuditEntries();
    assert.equal(empty.total, 0);
    assert.equal(empty.page, 1);
    assert.equal(empty.pageSize, 25);
    assert.deepEqual(empty.entries, []);

    await createGroup({ name: 'Alpha' });
    await createGroup({ name: 'Beta' });

    const out = await getAuditEntries();
    assert.equal(out.total, 4); // transactional snapshots plus service summaries
    assert.equal(out.entries.length, 4);
    assert.ok(out.entries.every((e) => e.action === 'group.create'));
    const summaries = out.entries.filter(e => e.details.source !== 'database');
    assert.ok(summaries.every((e) => e.actor === 'local'));
    // Newest first: Beta was created last.
    assert.equal(summaries[0].details.name, 'Beta');
    assert.equal(summaries[1].details.name, 'Alpha');
  } finally {
    await pool.end();
  }
});

test('getAuditEntries: filters by category and by actor', async () => {
  const pool = await freshDb();
  try {
    await createGroup({ name: 'Alpha' });
    await pool.query(
      `INSERT INTO audit_log (actor, action, details) VALUES
         ('local', 'cafe_adjustment.create', '{}'::jsonb),
         ('local', 'accounting_entry.post', '{}'::jsonb)`
    );

    // Matching category keeps the row.
    const groups = await getAuditEntries({ category: 'group' });
    assert.equal(groups.total, 2);

    const inventory = await getAuditEntries({ category: 'cafe_inventory' });
    assert.equal(inventory.total, 1);
    assert.equal(inventory.entries[0].action, 'cafe_adjustment.create');

    const accounting = await getAuditEntries({ category: 'accounting' });
    assert.equal(accounting.total, 1);
    assert.equal(accounting.entries[0].action, 'accounting_entry.post');

    // A different, valid category matches nothing.
    const users = await getAuditEntries({ category: 'user' });
    assert.equal(users.total, 0);
    assert.deepEqual(users.entries, []);

    // Actor filter is case-insensitive and matches 'local'.
    const byActor = await getAuditEntries({ actor: 'LOCAL' });
    assert.equal(byActor.total, 3);

    const byNobody = await getAuditEntries({ actor: 'nobody' });
    assert.equal(byNobody.total, 0);
  } finally {
    await pool.end();
  }
});
