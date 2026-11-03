// Service-layer test for student groups — real service functions against a
// fresh in-memory PGlite, exercising validation -> SQL -> PGlite -> result.
//
//   node --test src/core/services/groups.test.js
//
// Each test gets its own in-memory database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import {
  listGroups,
  getGroupMembers,
  createGroup,
  updateGroup,
  archiveGroup,
  setGroupMembers,
} from './groups.js';

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

// Insert a student directly (student_code must match ^[2-9A-HJ-NP-Z]{8}$).
async function addStudent(pool, code, fullName) {
  const result = await pool.query(
    `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
     VALUES ($1, $2,'female','2000-01-01','Test Father',lpad((SELECT count(*)+1 FROM students)::text,10,'0')) RETURNING id`,
    [code, fullName],
  );
  return result.rows[0].id;
}

test('create top-level and child groups; guards on parent and duplicate name', async () => {
  const pool = await freshDb();
  try {
    const { group: root } = await createGroup({ name: '  Grade  9 ' });
    assert.match(root.id, /^[0-9a-f-]{36}$/i);
    assert.equal(root.name, 'Grade 9'); // whitespace normalised
    assert.equal(root.parentId, null);
    assert.equal(root.memberCount, 0);

    const { group: child } = await createGroup({ name: 'Section A', parentId: root.id });
    assert.equal(child.parentId, root.id);

    // Duplicate top-level name (case-insensitive) collides.
    await expectCode('CONFLICT', () => createGroup({ name: 'grade 9' }));
    // Same child name under a different parent is fine (different namespace).
    const { group: root2 } = await createGroup({ name: 'Grade 10' });
    await createGroup({ name: 'Section A', parentId: root2.id }); // no throw

    await expectCode('VALIDATION', () => createGroup({ name: '' }));
    await expectCode('VALIDATION', () => createGroup({ name: 'X', parentId: 'nope' }));
    await expectCode('VALIDATION', () =>
      createGroup({ name: 'Y', parentId: '00000000-0000-4000-8000-000000000000' }),
    );
  } finally {
    await pool.end();
  }
});

test('list: all with member counts, archived toggle, and by studentId', async () => {
  const pool = await freshDb();
  try {
    const { group: a } = await createGroup({ name: 'Alpha' });
    const { group: b } = await createGroup({ name: 'Beta' });
    const sid = await addStudent(pool, 'ABCDEFGH', 'Ada Lovelace');
    await setGroupMembers(a.id, { add: [sid] });

    const all = await listGroups();
    assert.deepEqual(all.groups.map((g) => g.name), ['Alpha', 'Beta']);
    assert.equal(all.groups.find((g) => g.id === a.id).memberCount, 1);
    assert.equal(all.groups.find((g) => g.id === b.id).memberCount, 0);

    await archiveGroup(b.id);
    assert.deepEqual((await listGroups()).groups.map((g) => g.name), ['Alpha']);
    assert.equal((await listGroups({ includeArchived: true })).groups.length, 2);

    // Groups a given student belongs to.
    const mine = await listGroups({ studentId: sid });
    assert.deepEqual(mine.groups.map((g) => g.name), ['Alpha']);
    await expectCode('VALIDATION', () => listGroups({ studentId: 'nope' }));
  } finally {
    await pool.end();
  }
});

test('membership: add only live students, no-op re-add, remove, archived guard', async () => {
  const pool = await freshDb();
  try {
    const { group } = await createGroup({ name: 'Club' });
    const s1 = await addStudent(pool, 'ABCDEFGH', 'Grace Hopper');
    const s2 = await addStudent(pool, 'JKLMNPQR', 'Katherine Johnson');

    const first = await setGroupMembers(group.id, { add: [s1, s2] });
    assert.deepEqual(first, { added: 2, removed: 0 });

    // Re-adding is a no-op (ON CONFLICT DO NOTHING).
    const again = await setGroupMembers(group.id, { add: [s1] });
    assert.equal(again.added, 0);

    const members = await getGroupMembers(group.id);
    assert.deepEqual(members.students.map((s) => s.fullName), ['Grace Hopper', 'Katherine Johnson']);

    const removed = await setGroupMembers(group.id, { remove: [s1] });
    assert.deepEqual(removed, { added: 0, removed: 1 });

    await expectCode('VALIDATION', () => setGroupMembers(group.id, { add: ['not-a-uuid'] }));
    await expectCode('NOT_FOUND', () => getGroupMembers('00000000-0000-4000-8000-000000000000'));

    await archiveGroup(group.id);
    await expectCode('CONFLICT', () => setGroupMembers(group.id, { add: [s2] }));
  } finally {
    await pool.end();
  }
});

test('update: rename, move, cycle prevention, archive-with-children, guards', async () => {
  const pool = await freshDb();
  try {
    const { group: root } = await createGroup({ name: 'Root' });
    const { group: mid } = await createGroup({ name: 'Mid', parentId: root.id });
    const { group: leaf } = await createGroup({ name: 'Leaf', parentId: mid.id });

    const { group: renamed } = await updateGroup(leaf.id, { name: 'Leaflet' });
    assert.equal(renamed.name, 'Leaflet');

    // Move leaf to top level.
    const { group: moved } = await updateGroup(leaf.id, { parentId: null });
    assert.equal(moved.parentId, null);

    // Cycle: cannot move root under its own descendant (mid).
    await expectCode('CONFLICT', () => updateGroup(root.id, { parentId: mid.id }));
    // Cannot move a group under itself.
    await expectCode('CONFLICT', () => updateGroup(root.id, { parentId: root.id }));

    // Archiving a group with live subgroups is refused (root still has mid).
    await expectCode('CONFLICT', () => updateGroup(root.id, { archived: true }));

    await expectCode('VALIDATION', () => updateGroup(root.id, {}));
    await expectCode('VALIDATION', () => updateGroup(root.id, { archived: 'yes' }));
    await expectCode('NOT_FOUND', () => updateGroup('not-a-uuid', { name: 'Z' }));
  } finally {
    await pool.end();
  }
});

test('archive is idempotent, refuses with live children, and 404s a missing group', async () => {
  const pool = await freshDb();
  try {
    const { group: root } = await createGroup({ name: 'Parent' });
    const { group: child } = await createGroup({ name: 'Child', parentId: root.id });

    await expectCode('CONFLICT', () => archiveGroup(root.id)); // has a live child
    await archiveGroup(child.id); // ok
    await archiveGroup(child.id); // already archived — no-op
    await archiveGroup(root.id); // now child is gone, root archives
    await expectCode('NOT_FOUND', () =>
      archiveGroup('00000000-0000-4000-8000-000000000000'),
    );
  } finally {
    await pool.end();
  }
});

test('group actions write audit rows attributed to the local actor', async () => {
  const pool = await freshDb();
  try {
    const { group } = await createGroup({ name: 'Audited' });
    const sid = await addStudent(pool, 'ABCDEFGH', 'Alan Turing');
    await setGroupMembers(group.id, { add: [sid] });
    await updateGroup(group.id, { name: 'Audited2' });
    await archiveGroup(group.id);

    const audit = await pool.query(
      `SELECT action, actor FROM audit_log
       WHERE entity_type = 'group' AND details->>'source' IS DISTINCT FROM 'database' ORDER BY id`,
    );
    assert.deepEqual(
      audit.rows.map((r) => r.action),
      ['group.create', 'group.members', 'group.update', 'group.archive'],
    );
    assert.ok(audit.rows.every((r) => r.actor === 'local'));
  } finally {
    await pool.end();
  }
});
