// Service-layer tests for the assignment-period results grid and the
// dashboard (trends + constellation summary) — real service functions against
// a fresh in-memory PGlite.
//
//   node --test src/core/services/results.test.js
//
// Each test gets its own in-memory database.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createPglitePool } from '../../db/pglite.js';
import { initDb } from '../db.js';
import { resetLocalUser } from '../context.js';
import { getResults } from './results.js';
import { getSummary, getTrends } from './dashboard.js';
import { saveEvaluationsBulk } from './evaluations.js';

const migrationsDir = path.join(import.meta.dirname, '..', '..', 'db', 'migrations');
const DAY_MS = 24 * 60 * 60 * 1000;

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
  return pool;
}

async function expectCode(code, fn) {
  await assert.rejects(fn, (err) => {
    assert.equal(err.name, 'ServiceError', `expected a ServiceError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

async function addStudent(pool, code, fullName) {
  const result = await pool.query(
    `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
     VALUES ($1, $2,'female','2000-01-01','Test Father',lpad((SELECT count(*)+1 FROM students)::text,10,'0')) RETURNING id`,
    [code, fullName],
  );
  return result.rows[0].id;
}

// A group of two + a group assignment with 8 weekly sessions (2 periods) +
// two parameters, plus a convenience saver for one session cell.
async function seedFixture(pool) {
  const teacher = (
    await pool.query(
      `INSERT INTO teachers (code, full_name, birth_date, national_id)
       VALUES ('T1000001', 'Ms. Tester', '1990-05-01', '0012345678')
       RETURNING id`
    )
  ).rows[0].id;
  const interval = (
    await pool.query(
      `INSERT INTO intervals (name, every) VALUES ('هفتگی', '7 days') RETURNING id`
    )
  ).rows[0].id;
  const group = (
    await pool.query(
      `INSERT INTO student_groups (name, code) VALUES ('Group A', 'GA') RETURNING id`
    )
  ).rows[0].id;
  const ada = await addStudent(pool, 'ABCDEFGH', 'Ada Lovelace');
  const bob = await addStudent(pool, 'BCDEFGHJ', 'Bob Caesar');
  const memberships = {};
  for (const [name, studentId] of [['ada', ada], ['bob', bob]]) {
    memberships[name] = (
      await pool.query(
        `INSERT INTO student_group_members (student_id, group_id, joined_on)
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
  const start = Date.UTC(2024, 0, 6);
  const sessionIds = [];
  for (let index = 0; index < 8; index++) {
    const date = new Date(start + index * 7 * DAY_MS).toISOString().slice(0, 10);
    sessionIds.push(
      (
        await pool.query(
          `INSERT INTO sessions (assignment_id, seq, code, planned_date)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [assignmentId, index + 1, `S${index + 1}`, date],
        )
      ).rows[0].id
    );
  }
  const focus = (
    await pool.query(
      `INSERT INTO parameters (code, name, min_value, max_value)
       VALUES ('focus', 'Focus', 0, 10) RETURNING id`
    )
  ).rows[0].id;
  const speed = (
    await pool.query(
      `INSERT INTO parameters (code, name, min_value, max_value)
       VALUES ('speed', 'Speed', 0, 20) RETURNING id`
    )
  ).rows[0].id;

  async function save(sessionId, entries) {
    return saveEvaluationsBulk({ sessionId, entries });
  }

  async function fillFirstPeriod() {
    for (const sessionId of sessionIds.slice(1, 4)) {
      await save(sessionId, [
        {
          membershipId: null,
          parameterId: speed,
          selected: true,
          qualityValue: null,
          quantityValue: null,
          qualityComment: 'period attachment',
        },
      ]);
    }
  }

  return {
    assignmentId,
    group,
    memberships,
    sessionIds,
    focus,
    speed,
    save,
    fillFirstPeriod,
  };
}

test('getResults: validation, 404s, and a not-yet-bucketed period', async () => {
  const pool = await freshDb();
  try {
    const { assignmentId } = await seedFixture(pool);

    await expectCode('VALIDATION', () => getResults({ assignmentId: 'nope', seq: 1 }));
    await expectCode('VALIDATION', () => getResults({ assignmentId, seq: 0 }));
    await expectCode('VALIDATION', () =>
      getResults({ assignmentId, seq: 1, dimension: 'depth' })
    );
    await expectCode('NOT_FOUND', () =>
      getResults({ assignmentId: '00000000-0000-4000-8000-000000000000', seq: 1 })
    );
    await expectCode('VALIDATION', () => getResults({ assignmentId, seq: 1 }));
    await expectCode('VALIDATION', () =>
      getResults({ assignmentId, seq: 9 }) // no sessions bucketed there yet
    );
  } finally {
    await pool.end();
  }
});

test('getResults: grid rows, both dimensions, and the previous-seq deltas', async () => {
  const pool = await freshDb();
  try {
    const {
      assignmentId,
      memberships,
      sessionIds,
      focus,
      speed,
      save,
      fillFirstPeriod,
    } =
      await seedFixture(pool);

    // Period 1 (sessions 1–4): group + Ada answered; period 2 (5–8): only Bob.
    await save(sessionIds[0], [
      { membershipId: null, parameterId: focus, selected: true, qualityValue: 5, quantityValue: 6 },
      { membershipId: memberships.ada, parameterId: focus, selected: true, qualityValue: 7, quantityValue: 8 },
    ]);
    await fillFirstPeriod();
    await save(sessionIds[4], [
      { membershipId: memberships.bob, parameterId: focus, selected: true, qualityValue: 9, quantityValue: null },
    ]);

    const grid = await getResults({ assignmentId, seq: 2 });
    assert.equal(grid.period.seq, 2);
    assert.equal(grid.assignment.id, assignmentId);
    // Rows: the whole-group row first, then members alphabetically.
    assert.equal(grid.rows[0].membershipId, null);
    assert.equal(grid.rows[0].isGroup, true);
    assert.equal(grid.rows[1].membershipId, memberships.ada);
    assert.equal(grid.rows[2].membershipId, memberships.bob);
    // Columns: both parameters, in sort order.
    assert.deepEqual(
      grid.parameters.map((parameter) => parameter.code),
      ['focus', 'speed']
    );
    // Bob's period-2 cell carries both dimensions; cells are keyed by
    // parameter id and carry the answered state.
    const bobRow = grid.rows[2];
    assert.equal(bobRow.cells[focus].quality, 9);
    assert.equal(bobRow.cells[focus].quantity, null);
    assert.equal(bobRow.cells[focus].answered, true);
    assert.equal(bobRow.cells[speed], undefined); // never selected
    // Previous-seq deltas include the group fallback for Bob.
    assert.equal(grid.hasPrevious, true);
    assert.equal(grid.rows[0].previous[focus].quality, 5);
    assert.deepEqual(grid.rows[2].previous, {
      [focus]: { quality: 5, quantity: 6 },
      [speed]: { quality: null, quantity: null },
    });

    // The dimension toggle switches the value column without reshaping rows.
    const quantityGrid = await getResults({ assignmentId, seq: 1, dimension: 'quantity' });
    assert.equal(quantityGrid.dimension, 'quantity');
    assert.equal(quantityGrid.rows[0].cells[focus].quantity, 6);
    assert.equal(quantityGrid.rows[1].cells[focus].quantity, 8);
  } finally {
    await pool.end();
  }
});

test('getResults: group fallback uses each session date and selected-empty shadows', async () => {
  const pool = await freshDb();
  try {
    const { assignmentId, memberships, sessionIds, focus, save } = await seedFixture(pool);
    // Ada belongs on Jan 13 and Jan 20 only. Bob shadows Jan 6 with a blank.
    await pool.query(`UPDATE student_group_members SET joined_on = '2024-01-13', left_on = '2024-01-20' WHERE id = $1`, [memberships.ada]);
    for (let i = 0; i < 5; i++) {
      await save(sessionIds[i], [
        { membershipId: null, parameterId: focus, selected: true, qualityValue: i + 1, quantityValue: i === 1 ? 6 : null },
        ...(i === 0 ? [{ membershipId: memberships.bob, parameterId: focus, selected: true, qualityValue: null, quantityValue: null }] : []),
      ]);
      if (i === 0) {
        const first = await getResults({ assignmentId, seq: 1 });
        assert.equal(first.rows.length, 2, 'Ada has not joined at the only answered session');
        assert.deepEqual(first.rows[1].cells[focus], { quality: null, quantity: null, qualityComment: null, quantityComment: null, answered: false });
      }
    }
    const grid = await getResults({ assignmentId, seq: 2 });
    const ada = grid.rows.find(row => row.membershipId === memberships.ada);
    const bob = grid.rows.find(row => row.membershipId === memberships.bob);
    assert.deepEqual(ada.cells, {}, 'Ada left before the current period');
    assert.deepEqual(ada.previous[focus], { quality: 2.5, quantity: 6 });
    assert.deepEqual(bob.cells[focus], { quality: 5, quantity: null, qualityComment: null, quantityComment: null, answered: true });
    assert.deepEqual(bob.previous[focus], { quality: 3, quantity: 6 });
  } finally {
    await pool.end();
  }
});

test('getTrends: per (parameter, assignment, period) averages with a dimension choice', async () => {
  const pool = await freshDb();
  try {
    const {
      assignmentId,
      memberships,
      sessionIds,
      focus,
      speed,
      save,
      fillFirstPeriod,
    } =
      await seedFixture(pool);

    await save(sessionIds[0], [
      { membershipId: null, parameterId: focus, selected: true, qualityValue: 4, quantityValue: 10 },
      { membershipId: memberships.ada, parameterId: focus, selected: true, qualityValue: 8, quantityValue: 2 },
      { membershipId: memberships.ada, parameterId: speed, selected: true, qualityValue: 10, quantityValue: null },
    ]);
    await fillFirstPeriod();
    await save(sessionIds[4], [
      { membershipId: memberships.bob, parameterId: focus, selected: true, qualityValue: 6, quantityValue: null },
    ]);

    const { trends } = await getTrends({});
    // Period 1 focus quality: (4 + 8) / 2 = 6. Period 2: 6. Speed: 10.
    const point = (parameterId, seq) =>
      trends.find(
        (row) => row.parameterId === parameterId && row.periodSeq === seq
      );
    assert.equal(point(focus, 1).average, 6);
    assert.equal(point(focus, 1).assignmentId, assignmentId);
    assert.equal(point(focus, 2).average, 6);
    assert.equal(point(speed, 1).average, 10);
    assert.match(point(focus, 1).lastSessionDate, /^\d{4}-\d{2}-\d{2}$/);

    // The quantity dimension swaps the averaged column.
    const quantity = await getTrends({ dimension: 'quantity' });
    assert.equal(
      quantity.trends.find((row) => row.parameterId === focus && row.periodSeq === 1)
        .average,
      6
    );

    await expectCode('VALIDATION', () => getTrends({ dimension: 'depth' }));
    await expectCode('VALIDATION', () => getTrends({ groupId: 'nope' }));
  } finally {
    await pool.end();
  }
});

test('getTrends: effective members, inclusive dates and empty shadows precede averaging', async () => {
  const pool = await freshDb();
  try {
    const { assignmentId, group, memberships, sessionIds, focus, save } = await seedFixture(pool);
    for (const [code, name, added, left] of [
      ['CDEFGHJK', 'Charlie', '2024-01-06', '2024-01-06'],
      ['DEFGHJKL', 'Dan', '2024-01-13', null],
    ]) {
      const student = await addStudent(pool, code, name);
      await pool.query('INSERT INTO student_group_members (student_id, group_id, joined_on, left_on) VALUES ($1, $2, $3, $4)', [student, group, added, left]);
    }
    const cell = (membershipId, qualityValue, quantityValue) => ({ membershipId, parameterId: focus, selected: true, qualityValue, quantityValue });
    await save(sessionIds[0], [cell(null, 2, 6), cell(memberships.ada, 8, 4)]);
    let point = (await getTrends({ groupId: group })).trends[0];
    assert.equal(point.average, 4);
    assert.equal(point.count, 3);
    await save(sessionIds[1], [cell(null, 4, 8), cell(memberships.bob, null, null)]);
    point = (await getTrends({ groupId: group })).trends[0];
    assert.equal(point.average, 3.5, 'member period averages: Ada 6, Bob 2, Charlie 2, Dan 4');
    assert.equal(point.count, 5);
    assert.equal(point.lastSessionDate, '2024-01-13');
    const quantity = (await getTrends({ groupId: group, dimension: 'quantity' })).trends[0];
    assert.equal(quantity.average, 6.5);
    assert.equal(quantity.count, 5);
    // Individual assignments still contribute exactly their own member.
    const individual = (await pool.query(`INSERT INTO assignments (code, teacher_id, interval_id, membership_id, anchor_date)
      SELECT 'IND', teacher_id, interval_id, $2, anchor_date FROM assignments WHERE id = $1 RETURNING id`, [assignmentId, memberships.ada])).rows[0].id;
    const session = (await pool.query("INSERT INTO sessions (assignment_id, planned_date) VALUES ($1, '2024-01-06') RETURNING id", [individual])).rows[0].id;
    await save(session, [cell(memberships.ada, 0, 3)]);
    const own = (await getTrends({ groupId: group })).trends.find(p => p.assignmentId === individual);
    assert.equal(own.average, 0);
    assert.equal(own.count, 1);
  } finally {
    await pool.end();
  }
});

test('getSummary: expected = selected cells; group rows expand per member and member rows shadow', async () => {
  const pool = await freshDb();
  try {
    const { group, memberships, sessionIds, focus, save } = await seedFixture(pool);

    // Session 1: a group row (answered) + Ada's own row (unanswered) — Ada's
    // own row shadows the group row for her; Bob falls back to the group row.
    // Session 5: nothing selected.
    await save(sessionIds[0], [
      { membershipId: null, parameterId: focus, selected: true, qualityValue: 5, quantityValue: null },
      { membershipId: memberships.ada, parameterId: focus, selected: true, qualityValue: null, quantityValue: null },
    ]);
    const charlieId = await addStudent(pool, 'CDEFGHJK', 'Charlie Delta');
    await pool.query(
      `INSERT INTO student_group_members (student_id, group_id, joined_on)
       VALUES ($1, $2, current_date)`,
      [charlieId, group]
    );

    const { students, totals } = await getSummary({ groupId: group });
    const ada = students.find((student) => student.studentCode === 'ABCDEFGH');
    const bob = students.find((student) => student.studentCode === 'BCDEFGHJ');
    const charlie = students.find((student) => student.studentCode === 'CDEFGHJK');
    // One selected cell each: the group row (answered) expands to Bob, but
    // Ada's own unanswered row shadows it for her.
    assert.equal(ada.expected, 1);
    assert.equal(ada.answered, 0);
    assert.equal(ada.state, 'none');
    assert.equal(bob.expected, 1);
    assert.equal(bob.answered, 1);
    assert.equal(bob.state, 'full');
    // Charlie joined years after this historical session and must not inherit
    // its whole-group score merely because he is in today's roster.
    assert.equal(charlie.expected, 0);
    assert.equal(charlie.answered, 0);
    assert.equal(totals.expected, 2);
    assert.equal(totals.answered, 1);

    // Scoping to one assignment narrows the same math.
    const scoped = await getSummary({ groupId: group, assignmentId: undefined });
    assert.equal(scoped.totals.expected, 2);

    await expectCode('VALIDATION', () => getSummary({ groupId: 'nope' }));
    await expectCode('VALIDATION', () =>
      getSummary({ assignmentId: 'nope' })
    );
  } finally {
    await pool.end();
  }
});
