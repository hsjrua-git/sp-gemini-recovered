// Service-layer test for reading and bulk-saving evaluations (session cells)
// — real service functions against a fresh in-memory PGlite.
//
//   node --test src/core/services/evaluations.test.js
//
// Each test gets its own in-memory database. The test-admin collapse means
// the dry-run preview is never redacted and there is no "no override" refusal,
// but the lock guardrail is kept: changing a locked cell needs a written
// reason (audited).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { getEvaluations, saveEvaluationsBulk } from './evaluations.js';
import { createParameter } from './parameters.js';
import { homeOverview } from '../../lib/homeOverview.js';

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

// student_code must match ^[2-9A-HJ-NP-Z]{8}$.
async function addStudent(pool, code, fullName) {
  const result = await pool.query(
    `INSERT INTO students (student_code, full_name)
     VALUES ($1, $2) RETURNING id`,
    [code, fullName],
  );
  return result.rows[0].id;
}

const DAY_MS = 24 * 60 * 60 * 1000;
function isoDaysAgo(days) {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
}

// A teacher + interval + group + two members + a group assignment with one
// recent past session (close enough to today that fresh cells are not yet
// locked) — the minimum a session cell needs to exist.
async function seedSchedule(pool) {
  const teacher = (
    await pool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('T1000001', 'Ms. Tester', '1990-05-01', '0012345678')
       RETURNING id`
    )
  ).rows[0].id;
  const interval = (
    await pool.query(
      `INSERT INTO intervals (name, every) VALUES ('هفتگی', '7 days')
       RETURNING id`
    )
  ).rows[0].id;
  const group = (
    await pool.query(
      `INSERT INTO student_groups (name, code) VALUES ('Group A', 'GA')
       RETURNING id`
    )
  ).rows[0].id;
  const ada = await addStudent(pool, 'ABCDEFGH', 'Ada Lovelace');
  const bob = await addStudent(pool, 'BCDEFGHJ', 'Bob Caesar');
  const memberships = {};
  for (const [name, studentId] of [['ada', ada], ['bob', bob]]) {
    memberships[name] = (
      await pool.query(
        `INSERT INTO student_group_members (student_id, group_id, added_at)
         VALUES ($1, $2, '2020-01-01') RETURNING id`,
        [studentId, group],
      )
    ).rows[0].id;
  }
  const assignmentId = (
    await pool.query(
      `INSERT INTO assignments (code, teacher_id, interval_id, group_id, anchor_date)
       VALUES ('A1', $1, $2, $3, '2024-01-06') RETURNING id`,
      [teacher, interval, group],
    )
  ).rows[0].id;
  const sessionDate = isoDaysAgo(2);
  const sessionId = (
    await pool.query(
      `INSERT INTO sessions (assignment_id, seq, code, planned_date)
       VALUES ($1, 1, 'S1', $2) RETURNING id`,
      [assignmentId, sessionDate],
    )
  ).rows[0].id;
  return { assignmentId, sessionId, sessionDate, groupId: group, memberships, ada, bob };
}

test('home overview respects the database day, selected-cell completion, exclusions and list limits', async () => {
  const pool = await freshDb();
  try {
    await pool.query("SET TIME ZONE 'Asia/Tehran'");
    const { assignmentId, sessionId } = await seedSchedule(pool);
    const today = (await pool.query('SELECT CURRENT_DATE::text AS day')).rows[0].day;
    const initial = await homeOverview(pool);
    assert.equal(initial.today, today);
    assert.equal(initial.timeZone, 'Asia/Tehran');
    assert.equal(initial.studentCount, 2);
    assert.equal(initial.gradingCount, 1);
    const ids = [];
    for (let i = 0; i < 10; i++) {
      ids.push((await pool.query(`INSERT INTO sessions (assignment_id, planned_date, moved_to)
        VALUES ($1, CURRENT_DATE + $2::int, CURRENT_DATE) RETURNING id`, [assignmentId, i + 10])).rows[0].id);
    }
    for (const [i, extra] of ['future', 'canceled', 'archived'].entries()) {
      await pool.query(`INSERT INTO sessions (assignment_id, planned_date, moved_to, canceled_at, archived_at)
        VALUES ($1, CURRENT_DATE + $3::int, CURRENT_DATE + CASE WHEN $2 = 'future' THEN 1 ELSE 0 END,
          CASE WHEN $2 = 'canceled' THEN now() END, CASE WHEN $2 = 'archived' THEN now() END)`, [assignmentId, extra, i + 30]);
    }
    let home = await homeOverview(pool);
    assert.equal(home.classCount, 10);
    assert.equal(home.classes.length, 8);
    assert.equal(home.gradingCount, 11);
    assert.equal(home.grading.length, 8);
    assert.equal(home.grading[0].id, sessionId);
    const first = await createParameter({ code: 'home1', name: 'Home one', minValue: 0, maxValue: 100 });
    const second = await createParameter({ code: 'home2', name: 'Home two', minValue: 0, maxValue: 100 });
    await saveEvaluationsBulk({ sessionId: ids[0], entries: [{ parameterId: first.id, membershipId: null, selected: true, qualityValue: null, quantityValue: null, qualityComment: 'Comment-only answer' }] });
    await saveEvaluationsBulk({ sessionId: ids[1], entries: [{ parameterId: first.id, membershipId: null, selected: true, qualityValue: null, quantityValue: null }] });
    await saveEvaluationsBulk({ sessionId: ids[2], entries: [
      { parameterId: first.id, membershipId: null, selected: true, qualityValue: 0, quantityValue: null },
      { parameterId: second.id, membershipId: null, selected: true, qualityValue: null, quantityValue: null },
    ] });
    home = await homeOverview(pool);
    assert.equal(home.gradingCount, 10);
    assert.equal(home.partialCount, 1);
    assert.equal(home.notStartedCount, 9);
    const statuses = new Map(home.classes.map(row => [row.id, row.status]));
    assert.equal(statuses.get(ids[0]), 'complete');
    assert.equal(statuses.get(ids[1]), 'notStarted');
    assert.equal(statuses.get(ids[2]), 'partial');
    await pool.query('UPDATE assignments SET archived_at = now() WHERE id = $1', [assignmentId]);
    home = await homeOverview(pool);
    assert.equal(home.classCount, 0);
    assert.equal(home.gradingCount, 0);
    assert.deepEqual(home.classes, []);
  } finally { await pool.end(); }
});

test('getEvaluations: needs a filter, validates ids, reads stored rows', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, sessionDate, assignmentId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    // At least one filter is required.
    await expectCode('VALIDATION', () => getEvaluations({}));
    // Bad ids.
    await expectCode('VALIDATION', () => getEvaluations({ studentId: 'nope' }));
    await expectCode('VALIDATION', () => getEvaluations({ sessionId: 'nope' }));

    await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: null, parameterId: p.id, selected: true, qualityValue: 7, quantityValue: null },
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 5, quantityValue: 6 },
      ],
    });

    const bySession = await getEvaluations({ sessionId });
    assert.equal(bySession.evaluations.length, 2);
    assert.equal(bySession.evaluations[0].membershipId, null); // NULLS FIRST
    assert.equal(bySession.evaluations[0].qualityValue, 7);
    assert.equal(bySession.evaluations[0].isLocked, false); // fresh save locks in the future
    assert.equal(bySession.evaluations[0].sessionDate, sessionDate);
    assert.equal(bySession.evaluations[0].periodSeq, 1);

    // The whole-group row concerns every member; the member row is their own.
    const adaId = (
      await pool.query(
        'SELECT student_id AS "studentId" FROM student_group_members WHERE id = $1',
        [memberships.ada],
      )
    ).rows[0].studentId;
    const adaRows = (await getEvaluations({ studentId: adaId })).evaluations;
    assert.equal(adaRows.length, 2);
    const byAssignment = await getEvaluations({ assignmentId });
    assert.equal(byAssignment.evaluations.length, 2);
  } finally {
    await pool.end();
  }
});

test('saveEvaluationsBulk: input + precondition guards', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });
    const entry = { membershipId: null, parameterId: p.id, selected: true, qualityValue: 5, quantityValue: null };

    // Shape/flag validation.
    await expectCode('VALIDATION', () => saveEvaluationsBulk({ sessionId, entries: [entry], dryRun: 'yes' }));
    await expectCode('VALIDATION', () => saveEvaluationsBulk({ sessionId, entries: [entry], source: 'nope' }));
    await expectCode('VALIDATION', () => saveEvaluationsBulk({ sessionId: 'nope', entries: [entry] }));
    await expectCode('VALIDATION', () => saveEvaluationsBulk({ sessionId, entries: [] }));
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({ sessionId, entries: [{ membershipId: null, parameterId: p.id }] }) // no selected
    );

    // Unknown session → NOT_FOUND; a canceled session refuses to change.
    await expectCode('NOT_FOUND', () =>
      saveEvaluationsBulk({
        sessionId: '00000000-0000-4000-8000-000000000000',
        entries: [entry],
      })
    );
    const canceled = (
      await pool.query(
        `UPDATE sessions SET canceled_at = now() WHERE id = $1 RETURNING id`,
        [sessionId],
      )
    ).rows[0];
    await expectCode('CONFLICT', () => saveEvaluationsBulk({ sessionId: canceled.id, entries: [entry] }));
    await pool.query(`UPDATE sessions SET canceled_at = NULL WHERE id = $1`, [sessionId]);

    // A selected-unanswered cell is fine, but a comment over 500 chars is not.
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [
          { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: null, quantityValue: null, qualityComment: 'x'.repeat(501) },
        ],
      })
    );
  } finally {
    await pool.end();
  }
});

test('an individual assignment refuses whole-group rows', async () => {
  const pool = await freshDb();
  try {
    const { groupId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    // Re-target the assignment at Ada's membership only.
    const individual = (
      await pool.query(
        `UPDATE assignments SET group_id = NULL, membership_id = $1 WHERE group_id = $2 RETURNING id`,
        [memberships.ada, groupId],
      )
    ).rows[0];
    const session = (
      await pool.query(
        `INSERT INTO sessions (assignment_id, seq, code, planned_date)
         VALUES ($1, 2, 'SI', $2) RETURNING id`,
        [individual.id, isoDaysAgo(1)],
        [individual.id],
      )
    ).rows[0];

    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId: session.id,
        entries: [
          { membershipId: null, parameterId: p.id, selected: true, qualityValue: 5, quantityValue: null },
        ],
      })
    );
    // Its own member row is accepted.
    const saved = await saveEvaluationsBulk({
      sessionId: session.id,
      entries: [
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 5, quantityValue: null },
      ],
    });
    assert.deepEqual(saved, { sessionId: session.id, changed: 1 });
  } finally {
    await pool.end();
  }
});

test('group targets are memberships active on the session date, not today', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const parameter = await createParameter({
      code: 'history',
      name: 'Historical membership',
      minValue: 0,
      maxValue: 10,
    });

    await pool.query(
      `UPDATE student_group_members
       SET left_on = (SELECT session_date - 1 FROM sessions WHERE id = $2)
       WHERE id = $1`,
      [memberships.bob, sessionId]
    );
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [
          {
            membershipId: memberships.bob,
            parameterId: parameter.id,
            selected: true,
            qualityValue: 5,
            quantityValue: null,
          },
        ],
      })
    );

    await pool.query(
      `UPDATE student_group_members
       SET left_on = NULL,
           added_at = (SELECT session_date + 1 FROM sessions WHERE id = $2)
       WHERE id = $1`,
      [memberships.bob, sessionId]
    );
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [
          {
            membershipId: memberships.bob,
            parameterId: parameter.id,
            selected: true,
            qualityValue: 5,
            quantityValue: null,
          },
        ],
      })
    );
  } finally {
    await pool.end();
  }
});

test('semantic problems: range, unknown target, unknown parameter, duplicates', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });
    const ghost = '00000000-0000-4000-8000-000000000000';

    // Out-of-range → a problem, surfaced on details.problems.
    await assert.rejects(
      () =>
        saveEvaluationsBulk({
          sessionId,
          entries: [{ membershipId: null, parameterId: p.id, selected: true, qualityValue: 101, quantityValue: null }],
        }),
      (err) => {
        assert.equal(err.code, 'VALIDATION');
        assert.ok(Array.isArray(err.details?.problems) && err.details.problems.length === 1);
        return true;
      },
    );

    // Unknown target / parameter / duplicate cell.
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [{ membershipId: ghost, parameterId: p.id, selected: true, qualityValue: 1, quantityValue: null }],
      })
    );
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [{ membershipId: null, parameterId: ghost, selected: true, qualityValue: 1, quantityValue: null }],
      })
    );
    await expectCode('VALIDATION', () =>
      saveEvaluationsBulk({
        sessionId,
        entries: [
          { membershipId: null, parameterId: p.id, selected: true, qualityValue: 1, quantityValue: null },
          { membershipId: null, parameterId: p.id, selected: true, qualityValue: 2, quantityValue: null },
        ],
      })
    );
  } finally {
    await pool.end();
  }
});

test('dryRun previews without writing and is never redacted', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    const preview = await saveEvaluationsBulk({
      sessionId,
      dryRun: true,
      entries: [
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 8, quantityValue: null },
      ],
    });
    assert.equal(preview.dryRun, true);
    assert.equal(preview.sessionId, sessionId);
    assert.equal(preview.redacted, undefined); // single admin: full visibility
    assert.deepEqual(preview.problems, []);
    assert.ok(Array.isArray(preview.cells));
    assert.ok(preview.counts && typeof preview.counts === 'object');

    // The preview wrote nothing.
    assert.equal((await getEvaluations({ sessionId })).evaluations.length, 0);
  } finally {
    await pool.end();
  }
});

test('a save creates cells; identical re-save is a no-op; unselect deletes', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    // A selected-unanswered cell + an answered one.
    const saved = await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: null, parameterId: p.id, selected: true, qualityValue: 6, quantityValue: null, qualityComment: 'good' },
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: null, quantityValue: null },
      ],
    });
    assert.deepEqual(saved, { sessionId, changed: 2 });

    const { evaluations } = await getEvaluations({ sessionId });
    const groupRow = evaluations.find((row) => row.membershipId === null);
    const adaRow = evaluations.find((row) => row.membershipId === memberships.ada);
    assert.equal(groupRow.qualityValue, 6);
    assert.equal(groupRow.qualityComment, 'good');
    // A row with no values and no comments is still a stored expectation.
    assert.equal(adaRow.qualityValue, null);
    assert.equal(adaRow.quantityValue, null);

    // Writing the same cells again changes nothing.
    const again = await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: null, parameterId: p.id, selected: true, qualityValue: 6, quantityValue: null, qualityComment: 'good' },
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: null, quantityValue: null },
      ],
    });
    assert.deepEqual(again, { sessionId, changed: 0 });
    assert.equal(
      (await pool.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE action = 'scores.save'"
      )).rows[0].n,
      1,
    );

    // Unselecting the whole-group row deletes it (a stored row IS the expectation).
    const unselected = await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: null, parameterId: p.id, selected: false, qualityValue: null, quantityValue: null },
      ],
    });
    assert.deepEqual(unselected, { sessionId, changed: 1 });
    const after = (await getEvaluations({ sessionId })).evaluations;
    assert.equal(after.length, 1);
    assert.equal(after[0].membershipId, memberships.ada);
  } finally {
    await pool.end();
  }
});

test('a real save records one audit row with old/new cell snapshots', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 6, quantityValue: null },
      ],
    });
    await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 8, quantityValue: null },
      ],
    });

    const audit = await pool.query(
      `SELECT action, entity_type AS "entityType", entity_id AS "entityId",
              old_data AS "oldData", new_data AS "newData", details
       FROM audit_log WHERE action = 'scores.save' ORDER BY id`
    );
    assert.equal(audit.rows.length, 2);
    assert.equal(audit.rows[0].action, 'scores.save');
    assert.equal(audit.rows[0].entityType, 'session');
    assert.equal(audit.rows[0].entityId, sessionId);
    // The first save created the row; the second changed it 6 → 8.
    assert.equal(audit.rows[0].oldData.cells[0].existed, false);
    assert.equal(audit.rows[1].oldData.cells[0].qualityValue, 6);
    assert.equal(audit.rows[1].newData.cells[0].qualityValue, 8);
    assert.equal(audit.rows[1].details.count, 1);
  } finally {
    await pool.end();
  }
});

test('a locked cell needs a written override reason (audited)', async () => {
  const pool = await freshDb();
  try {
    const { sessionId, memberships } = await seedSchedule(pool);
    const p = await createParameter({ code: 'focus', name: 'Focus', minValue: 0, maxValue: 10 });

    // Hand-insert an already-locked cell (locks_at in the past).
    await pool.query(
      `INSERT INTO evaluations (session_id, parameter_id, membership_id, quality_value, locks_at)
       VALUES ($1, $2, $3, 4, now() - interval '1 day')`,
      [sessionId, p.id, memberships.ada],
    );

    // Changing it with no reason → OVERRIDE_REASON_REQUIRED, nothing saved.
    await assert.rejects(
      () =>
        saveEvaluationsBulk({
          sessionId,
          entries: [
            { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 9, quantityValue: null },
          ],
        }),
      (err) => {
        assert.equal(err.code, 'VALIDATION');
        assert.equal(err.details?.code, 'OVERRIDE_REASON_REQUIRED');
        assert.ok(err.details.problems.length === 1);
        return true;
      },
    );
    assert.equal((await getEvaluations({ sessionId })).evaluations[0].qualityValue, 4);

    // With a reason it goes through and the reason lands in the audit trail.
    const saved = await saveEvaluationsBulk({
      sessionId,
      entries: [
        { membershipId: memberships.ada, parameterId: p.id, selected: true, qualityValue: 9, quantityValue: null },
      ],
      overrideReason: 'Correcting a data-entry error after review.',
    });
    assert.deepEqual(saved, { sessionId, changed: 1 });
    assert.equal((await getEvaluations({ sessionId })).evaluations[0].qualityValue, 9);

    const audit = await pool.query(
      "SELECT details FROM audit_log WHERE action = 'scores.save' ORDER BY id"
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].details.overrideReason, 'Correcting a data-entry error after review.');
    assert.equal(audit.rows[0].details.changes[0].override, true);
  } finally {
    await pool.end();
  }
});
