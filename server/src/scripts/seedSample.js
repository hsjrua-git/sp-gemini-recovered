import pool from '../db/pool.js';
import { todayIso } from '../lib/periods.js';
import { generateSessions } from '../lib/sessions.js';
import { generateStudentCode, generateTeacherCode } from '../lib/studentCode.js';
import { seedWorkflowDetails } from './workflowSample.js';
import {
  removeConnectedSample,
  SAMPLE_PASSWORD,
  seedConnectedSample,
  seedSampleUsers,
} from './sampleModules.js';

// Dev-only sample data for the schema-4 evaluation model. Creates a
// self-contained fixture world the dashboards and the 3D constellation can
// show in all their states (full / partial / none):
//   6 parameters (ranged integers, no unit), 2 sample groups holding 30
//   students, 3 teachers, the two common intervals when the table is empty,
//   4 group assignments plus one individual assignment anchored in the past, sessions generated up to
//   today + 30 days (so most of the schedule is already past), answered-session
//   periods attached by database triggers, and evaluations on PAST sessions: for
//   every selected cell a row exists — the whole-group row (membership NULL)
//   plus a few individual members — with a completion ramp from ~100%
//   answered (oldest sessions) to ~55% (newest), about 70% overall, and
//   occasional single-sided (sparse) answers and comments.
//
// Idempotent by refusal: it will not run while sample data exists.
// `remove` / `--remove` deletes exactly what was created, matched by the
// code/name prefixes below, in FK order: evaluations → tasks/alerts →
// sessions → periods → assignments → teachers (if unused) → parameters
// (if unreferenced) → memberships → students → groups.
//
// Everything runs in ONE transaction: either the whole sample world lands
// or nothing does.

const STUDENT_PREFIX = 'Sample Student';
const STUDENT_COUNT = 30;
const GROUP_NAME_PREFIX = 'Sample ';
const TEACHER_NAME_PREFIX = 'Sample Teacher ';
const ASSIGNMENT_CODE_PREFIX = 'SAMPLE-';

// Sessions are generated UP TO this horizon (today + N days), so with anchors
// weeks in the past a good chunk of each schedule is already answerable.
const SESSION_HORIZON_DAYS = 30;

// Individual member cells per past session, on top of the whole-group row.
const MEMBERS_PER_SESSION = 3;

const PARAMETERS = [
  { code: 'speed', name: 'سرعت (Speed)', min: 0, max: 100, sortOrder: 10 },
  { code: 'endurance', name: 'استقامت (Endurance)', min: 0, max: 100, sortOrder: 20 },
  { code: 'accuracy', name: 'دقت (Accuracy)', min: 0, max: 100, sortOrder: 30 },
  { code: 'teamwork', name: 'کار تیمی (Teamwork)', min: 0, max: 10, sortOrder: 40 },
  { code: 'discipline', name: 'نظم (Discipline)', min: 0, max: 10, sortOrder: 50 },
  { code: 'participation', name: 'مشارکت (Participation)', min: 0, max: 10, sortOrder: 60 },
];

const TEACHERS = [
  { name: 'Sample Teacher 1 — مریم احمدی', birthDate: '1985-04-12', nationalId: '0000000001' },
  { name: 'Sample Teacher 2 — رضا کریمی', birthDate: '1979-11-03', nationalId: '0000000002' },
  { name: 'Sample Teacher 3 — سارا موسوی', birthDate: '1990-06-25', nationalId: '0000000003' },
];

const GROUPS = [
  { name: 'Sample Group A', code: 'sample-a', sortOrder: 10 },
  { name: 'Sample Group B', code: 'sample-b', sortOrder: 20 },
];

// Group targets plus one individual-member target. anchorOffset is days from today (negative = past), so
// every assignment has answered history by the time the script finishes.
// intervalPreference indexes the interval candidates after the weekly-first
// sort (wraps around if fewer exist).
const ASSIGNMENTS = [
  { code: 'SAMPLE-A1', name: 'Sample — Group A weekly', groupIndex: 0, anchorOffset: -56, intervalPreference: 0, sortOrder: 10 },
  { code: 'SAMPLE-A2', name: 'Sample — Group B weekly', groupIndex: 1, anchorOffset: -42, intervalPreference: 0, sortOrder: 20 },
  { code: 'SAMPLE-A3', name: 'Sample — Group A fortnightly', groupIndex: 0, anchorOffset: -70, intervalPreference: 1, sortOrder: 30 },
  { code: 'SAMPLE-A4', name: 'Sample — Group B drills', groupIndex: 1, anchorOffset: -56, intervalPreference: 2, sortOrder: 40 },
  { code: 'SAMPLE-I1', name: 'Sample — Individual coaching', groupIndex: 0, memberIndex: 0, anchorOffset: -35, intervalPreference: 0, sortOrder: 50 },
];

const COMMENTS = [
  'پیشرفت محسوس نسبت به جلسه قبل',
  'نیاز به تمرین بیشتری دارد',
  'عملکرد خوب در تمرین گروهی',
  'خستگی در اواخر جلسه',
  'Good progress this week',
  'Needs follow-up on accuracy',
];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function addDaysIso(iso, days) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// Deterministic PRNG (mulberry32): every run seeds the same shape, so
// screenshots and dashboards stay comparable between resets.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Weekly first, then fortnightly, then whatever else exists. `every::text`
// renders '1 month' as '1 mon', so no special case for it — it lands in "rest".
function intervalRank(everyText) {
  if (everyText === '7 days') return 0;
  if (everyText === '14 days') return 1;
  return 2;
}

// Pick 3-4 parameters per session, weighted toward the front of the list so
// the dashboards show visibly different coverage per parameter instead of a
// uniform blur. Without replacement; list order is the DB's sort_order.
function pickParameters(rand, parameters) {
  const remaining = parameters.map((p, index) => ({ p, weight: parameters.length - index }));
  const count = Math.min(3 + (rand() < 0.5 ? 0 : 1), remaining.length);
  const picked = [];
  for (let n = 0; n < count && remaining.length > 0; n++) {
    const total = remaining.reduce((sum, item) => sum + item.weight, 0);
    let roll = rand() * total;
    let index = remaining.length - 1;
    for (let i = 0; i < remaining.length; i++) {
      roll -= remaining[i].weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    picked.push(remaining[index].p);
    remaining.splice(index, 1);
  }
  return picked;
}

// A rotating window of distinct members so every student gets individual
// cells over time.
function pickMembers(rand, roster) {
  const count = Math.min(MEMBERS_PER_SESSION, roster.length);
  const start = Math.floor(rand() * roster.length);
  const picked = [];
  for (let j = 0; j < count; j++) {
    picked.push(roster[(start + j) % roster.length]);
  }
  return picked;
}

// Integer inside the parameter's own [min, max] (null bounds → 0..10),
// wobbling around the target's ability so trends look like trends.
function valueFor(rand, ability, parameter) {
  const lo = parameter.minValue ?? 0;
  const hi = parameter.maxValue ?? 10;
  const frac = Math.min(1, Math.max(0, ability + (rand() - 0.5) * 0.3));
  return Math.round(lo + (hi - lo) * frac);
}

async function removeSample() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    // Sample history may already be past its lock deadline. The database lock
    // guard applies to DELETE as well as edits, so fixture teardown supplies a
    // transaction-local, explicit maintenance reason.
    await client.query(
      `SELECT set_config('app.override_reason', 'remove sample fixture', true)`
    );

    const connected = await removeConnectedSample(client);

    const sampleAssignments = await client.query(
      'SELECT id FROM assignments WHERE code LIKE $1',
      [`${ASSIGNMENT_CODE_PREFIX}%`]
    );
    const assignmentIds = sampleAssignments.rows.map((row) => row.id);

    let evaluationsDeleted = 0;
    let tasksDeleted = 0;
    let alertsDeleted = 0;
    let sessionsDeleted = 0;
    let periodsDeleted = 0;
    let assignmentsDeleted = 0;

    if (assignmentIds.length > 0) {
      // Scores live on the sample assignments' sessions (group rows reference
      // no student, so deleting by student would miss them).
      const evaluations = await client.query(
        `DELETE FROM evaluations
         WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id = ANY($1::uuid[]))`,
        [assignmentIds]
      );
      evaluationsDeleted = evaluations.rowCount;

      // Tasks and alerts hang off sessions with ON DELETE CASCADE; deleted
      // explicitly so the log tells the truth.
      const tasks = await client.query(
        `DELETE FROM tasks
         WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id = ANY($1::uuid[]))`,
        [assignmentIds]
      );
      tasksDeleted = tasks.rowCount;
      const alerts = await client.query(
        `DELETE FROM alerts
         WHERE session_id IN (SELECT id FROM sessions WHERE assignment_id = ANY($1::uuid[]))`,
        [assignmentIds]
      );
      alertsDeleted = alerts.rowCount;

      const sessions = await client.query(
        'DELETE FROM sessions WHERE assignment_id = ANY($1::uuid[])',
        [assignmentIds]
      );
      sessionsDeleted = sessions.rowCount;
      const periods = await client.query(
        'DELETE FROM periods WHERE assignment_id = ANY($1::uuid[])',
        [assignmentIds]
      );
      periodsDeleted = periods.rowCount;
      const assignments = await client.query(
        'DELETE FROM assignments WHERE id = ANY($1::uuid[])',
        [assignmentIds]
      );
      assignmentsDeleted = assignments.rowCount;
    }

    // Teachers we created — unless a non-sample assignment still uses them.
    const teachers = await client.query(
      `DELETE FROM teachers t
       WHERE t.full_name LIKE $1
         AND NOT EXISTS (SELECT 1 FROM assignments a WHERE a.teacher_id = t.id)`,
      [`${TEACHER_NAME_PREFIX}%`]
    );

    // Parameters we created — only when nothing outside the sample world
    // still references them (evaluations on other sessions, tasks, templates).
    const parameters = await client.query(
      `DELETE FROM parameters p
       WHERE p.code = ANY($1::text[])
         AND NOT EXISTS (SELECT 1 FROM evaluations e WHERE e.parameter_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM tasks tk WHERE tk.parameter_id = p.id)
         AND NOT EXISTS (SELECT 1 FROM task_templates tt WHERE tt.parameter_id = p.id)`,
      [PARAMETERS.map((p) => p.code)]
    );

    // Memberships reference students with no cascade, so clear them first.
    const memberships = await client.query(
      `DELETE FROM student_group_members
       WHERE student_id IN (SELECT id FROM students WHERE full_name LIKE $1)`,
      [`${STUDENT_PREFIX}%`]
    );
    const students = await client.query(
      'DELETE FROM students WHERE full_name LIKE $1',
      [`${STUDENT_PREFIX}%`]
    );

    // Groups last; any leftover membership cascades away with its group.
    const groups = await client.query(
      `WITH removed AS (
         DELETE FROM student_groups WHERE name LIKE $1 RETURNING id
       ) SELECT count(*)::int AS count FROM removed`,
      [`${GROUP_NAME_PREFIX}%`]
    );

    await client.query('COMMIT');
    console.log(
      'Removed sample data:\n' +
        `  evaluations: ${evaluationsDeleted}\n` +
        `  tasks:       ${tasksDeleted}\n` +
        `  alerts:      ${alertsDeleted}\n` +
        `  sessions:    ${sessionsDeleted}\n` +
        `  periods:     ${periodsDeleted}\n` +
        `  assignments: ${assignmentsDeleted}\n` +
        `  teachers:    ${teachers.rowCount} (only those no remaining assignment uses)\n` +
        `  parameters:  ${parameters.rowCount} (only those nothing remaining references)\n` +
        `  sample users deactivated: ${connected.users}\n` +
        `  memberships: ${memberships.rowCount}\n` +
        `  students:    ${students.rowCount}\n` +
        `  groups:      ${groups.rows[0].count}`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function addSample() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_SAMPLE_DATA !== '1') {
    fail('Sample data is disabled in production. Use a development database or set ALLOW_SAMPLE_DATA=1 explicitly.');
  }
  const today = todayIso();

  // Refuse to run twice (either half of the fixture world counts as existing).
  const [studentsCheck, assignmentsCheck, parametersCheck] = await Promise.all([
    pool.query('SELECT count(*)::int AS count FROM students WHERE full_name LIKE $1', [
      `${STUDENT_PREFIX}%`,
    ]),
    pool.query('SELECT count(*)::int AS count FROM assignments WHERE code LIKE $1', [
      `${ASSIGNMENT_CODE_PREFIX}%`,
    ]),
    pool.query('SELECT code FROM parameters WHERE code = ANY($1::text[]) LIMIT 1', [
      PARAMETERS.map((p) => p.code),
    ]),
  ]);
  if (studentsCheck.rows[0].count > 0 || assignmentsCheck.rows[0].count > 0) {
    fail('Sample data already exists. Remove it first: npm run seed-sample -- remove');
  }
  if (parametersCheck.rows[0]) {
    fail(
      `A parameter with code "${parametersCheck.rows[0].code}" already exists. ` +
        'Remove or rename it first: npm run seed-sample would collide with it.'
    );
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Predictable role accounts let every permission-specific page be tested.
    // They are development fixtures only (the production guard above refuses
    // them by default), and removeSample deactivates their retained audit actors.
    const users = await seedSampleUsers(client);

    // 1. Parameters (integer ranges, no unit — the schema-4 shape).
    for (const parameter of PARAMETERS) {
      await client.query(
        `INSERT INTO parameters (name, code, min_value, max_value, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [parameter.name, parameter.code, parameter.min, parameter.max, parameter.sortOrder]
      );
    }
    const parametersResult = await client.query(
      `SELECT id, min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE code = ANY($1::text[])
       ORDER BY sort_order`,
      [PARAMETERS.map((p) => p.code)]
    );

    // 2. Students (same retry loop as before: codes are random, collisions
    // with existing rows are re-rolled).
    const studentIds = [];
    for (let i = 1; i <= STUDENT_COUNT; i++) {
      const name = `${STUDENT_PREFIX} ${String(i).padStart(2, '0')}`;
      let id = null;
      while (id === null) {
        const inserted = await client.query(
          `INSERT INTO students (student_code, full_name,gender,birth_date,father_name,national_id)
           VALUES ($1, $2,'female','2000-01-01','Sample Father',$3)
           ON CONFLICT (student_code) DO NOTHING
           RETURNING id`,
          [generateStudentCode(), name, String(9000000000 + i)]
        );
        id = inserted.rows[0]?.id ?? null;
      }
      studentIds.push(id);
    }

    // 3. Groups + memberships: first half in group A, rest in group B. Each
    // member gets a fixed ability (0..1) so individual answers trend sensibly.
    const groupIds = [];
    for (const group of GROUPS) {
      const inserted = await client.query(
        `INSERT INTO student_groups (name, code, sort_order)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [group.name, group.code, group.sortOrder]
      );
      groupIds.push(inserted.rows[0].id);
    }
    const rosters = GROUPS.map(() => []);
    for (let i = 0; i < studentIds.length; i++) {
      const groupIndex = i < studentIds.length / 2 ? 0 : 1;
      const ability = 0.3 + 0.6 * (((i * 37) % 17) / 16);
      const inserted = await client.query(
        `INSERT INTO student_group_members (student_id, group_id, joined_on)
         VALUES ($1, $2, current_date - 365)
         RETURNING id`,
        [studentIds[i], groupIds[groupIndex]]
      );
      rosters[groupIndex].push({ membershipId: inserted.rows[0].id, ability });
    }
    // One historical membership exercises the past-members UI and date
    // serialization without changing either group's active roster.
    await client.query(
      `INSERT INTO student_group_members
         (student_id, group_id, joined_on, left_on)
       VALUES ($1, $2, now() - interval '180 days', current_date - 120)`,
      [studentIds[0], groupIds[1]]
    );

    // 4. Teachers (full identity — the columns are NOT NULL since migration 017).
    const teacherIds = [];
    for (const teacher of TEACHERS) {
      let id = null;
      while (id === null) {
        const inserted = await client.query(
          `INSERT INTO teachers (code, full_name, birth_date, national_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (code) DO NOTHING
           RETURNING id`,
          [generateTeacherCode(), teacher.name, teacher.birthDate, teacher.nationalId]
        );
        id = inserted.rows[0]?.id ?? null;
      }
      teacherIds.push(id);
    }

    // 5. Intervals — only when the table is empty (a fresh install from
    // migration 018 already has the four common rhythms).
    const intervalCount = await client.query('SELECT count(*)::int AS count FROM intervals');
    let seededIntervals = 0;
    if (intervalCount.rows[0].count === 0) {
      const inserted = await client.query(
        `INSERT INTO intervals (name, every, sort_order) VALUES
           ('هفتگی', $1::interval, 10),
           ('ماهانه', $2::interval, 20)`,
        ['7 days', '1 month']
      );
      seededIntervals = inserted.rowCount;
    }
    const intervalsResult = await client.query(
      `SELECT id, every::text AS every
       FROM intervals
       WHERE archived_at IS NULL
       ORDER BY sort_order`
    );
    const intervalCandidates = intervalsResult.rows
      .map((row, index) => ({ row, index }))
      .sort(
        (a, b) => intervalRank(a.row.every) - intervalRank(b.row.every) || a.index - b.index
      )
      .map((entry) => entry.row);
    if (intervalCandidates.length === 0) {
      fail('No active intervals exist — create one first (Scheduling page).');
    }

    // 6. Assignments (group targets, anchored in the past).
    const assignmentIds = [];
    for (const [index, assignment] of ASSIGNMENTS.entries()) {
      const interval =
        intervalCandidates[assignment.intervalPreference % intervalCandidates.length];
      const inserted = await client.query(
       `INSERT INTO assignments
            (code, name, teacher_id, interval_id, group_id, membership_id, anchor_date, sort_order)
          VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
          RETURNING id`,
        [
          assignment.code,
          assignment.name,
          teacherIds[index % teacherIds.length],
          interval.id,
          assignment.memberIndex === undefined ? groupIds[assignment.groupIndex] : null,
          assignment.memberIndex === undefined
            ? null
            : rosters[assignment.groupIndex][assignment.memberIndex].membershipId,
          addDaysIso(today, assignment.anchorOffset),
          assignment.sortOrder,
        ]
      );
      assignmentIds.push(inserted.rows[0].id);
    }

    // 7. Sessions up to today + horizon (some past, some future). Generated
    // sessions do not occupy periods until they receive their first answer.
    const until = addDaysIso(today, SESSION_HORIZON_DAYS);
    let sessionsCreated = 0;
    for (const assignmentId of assignmentIds) {
      sessionsCreated += await generateSessions(client, { until, assignmentId });
    }

    // 8. Evaluations on the PAST, non-canceled sessions of the sample
    // assignments. Every selected cell gets a row (the whole-group row +
    // MEMBERS_PER_SESSION members); the completion ramp makes older sessions
    // nearly fully answered and the newest ones roughly half done.
    const sessionsResult = await client.query(
      `SELECT s.id,
              s.assignment_id AS "assignmentId",
              s.session_date::text AS "sessionDate"
       FROM sessions s
       WHERE s.assignment_id = ANY($1::uuid[])
         AND s.canceled_at IS NULL
         AND s.archived_at IS NULL
         AND s.session_date < $2::date
       ORDER BY s.session_date, s.seq`,
      [assignmentIds, today]
    );
    const rosterByAssignment = new Map(
      ASSIGNMENTS.map((assignment, index) => [
        assignmentIds[index],
        assignment.memberIndex === undefined
          ? rosters[assignment.groupIndex]
          : [rosters[assignment.groupIndex][assignment.memberIndex]],
      ])
    );
    const assignmentById = new Map(
      ASSIGNMENTS.map((assignment, index) => [assignmentIds[index], assignment])
    );

    const rand = mulberry32(0x5eed);
    const cells = {
      sessions: [],
      parameters: [],
      memberships: [],
      quality: [],
      quantity: [],
      qualityComments: [],
      quantityComments: [],
    };
    let answered = 0;
    const seenKeys = new Set();

    for (const [sessionIndex, session] of sessionsResult.rows.entries()) {
      const total = sessionsResult.rows.length;
      // Oldest session ≈ always answered, newest past session ≈ 55%.
      const ramp = total <= 1 ? 0.75 : 1 - 0.45 * (sessionIndex / (total - 1));
      const roster = rosterByAssignment.get(session.assignmentId) ?? [];

      const assignment = assignmentById.get(session.assignmentId);
      const targets = assignment?.memberIndex === undefined
        ? [
            { membershipId: null, ability: 0.55 }, // the whole-group row
            ...pickMembers(rand, roster),
          ]
        : roster;
      const perSessionParams = new Set();
      const indexZeroKeys = [];
      for (const parameter of pickParameters(rand, parametersResult.rows)) {
        if (perSessionParams.has(parameter.id)) {
          throw new Error(
            `seed bug: pickParameters repeated ${parameter.code} in session ${session.id}`
          );
        }
        perSessionParams.add(parameter.id);
        for (const target of targets) {
          const key = `${session.id}:${parameter.id}:${target.membershipId ?? 'group'}`;
          if (seenKeys.has(key)) {
            throw new Error(
              `seed bug: duplicate cell session=${session.id} (index ${sessionIndex}, ` +
                `assignment ${session.assignmentId}) param=${parameter.id}(${parameter.code}) ` +
                `target=${target.membershipId ?? 'group'} ` +
                `targetsLen=${targets.length} paramsThisSession=${[...perSessionParams].length} ` +
                `keysAtThisIndex=[${indexZeroKeys.join(' | ')}]`
            );
          }
          if (sessionIndex === 0) indexZeroKeys.push(key);
          seenKeys.add(key);
          const ratio = Math.min(1, Math.max(0.3, ramp + (rand() - 0.5) * 0.2));
          const isAnswered = rand() < ratio;
          let qualityValue = null;
          let quantityValue = null;
          let qualityComment = null;
          let quantityComment = null;
          if (isAnswered) {
            // Sparse data: 70% both values, 15% quality only, 15% quantity
            // only; a comment rides along about a fifth of the time.
            const shape = rand();
            if (shape < 0.7) {
              qualityValue = valueFor(rand, target.ability, { minValue: 0, maxValue: 100 });
              quantityValue = valueFor(rand, target.ability, parameter);
            } else if (shape < 0.85) {
              qualityValue = valueFor(rand, target.ability, { minValue: 0, maxValue: 100 });
            } else {
              quantityValue = valueFor(rand, target.ability, parameter);
            }
            if (rand() < 0.2) {
              const comment = COMMENTS[Math.floor(rand() * COMMENTS.length)];
              if (qualityValue !== null) qualityComment = comment;
              else quantityComment = comment;
            }
            answered += 1;
          }
          cells.sessions.push(session.id);
          cells.parameters.push(parameter.id);
          cells.memberships.push(target.membershipId);
          cells.quality.push(qualityValue);
          cells.quantity.push(quantityValue);
          cells.qualityComments.push(qualityComment);
          cells.quantityComments.push(quantityComment);
        }
      }
    }

    if (cells.sessions.length > 0) {
      await client.query(
        `INSERT INTO evaluations
           (session_id, parameter_id, membership_id,
             quality_value, quantity_value, quality_comment, quantity_comment)
          SELECT s, p, m, q, n, qc, nc
         FROM unnest($1::uuid[], $2::uuid[], $3::uuid[], $4::int[], $5::int[],
                      $6::text[], $7::text[])
               AS t(s, p, m, q, n, qc, nc)`,
        [
          cells.sessions,
          cells.parameters,
          cells.memberships,
          cells.quality,
          cells.quantity,
          cells.qualityComments,
          cells.quantityComments,
        ]
      );
    }
    const periodCount = (
      await client.query(
        `SELECT count(*)::int AS count
         FROM period_summary
         WHERE assignment_id = ANY($1::uuid[])
           AND sessions_count > 0`,
        [assignmentIds]
      )
    ).rows[0].count;

    // 9. Connected fixtures for identity/custom fields, tasks/alerts, cafe,
    // accounting, audit, role-specific logins and voice transcripts.
    const connected = await seedConnectedSample(client, {
      today,
      studentIds,
      parameters: parametersResult.rows,
      sessions: sessionsResult.rows,
      rosters,
      rosterByAssignment,
      users,
    });
    await seedWorkflowDetails(client, { groupIds, studentIds });

    await client.query('COMMIT');
    console.log(
      `Seeded sample data (today: ${today}):\n` +
        `  parameters:           ${parametersResult.rows.length}\n` +
        `  groups:               ${GROUPS.length + 2} (${STUDENT_COUNT} students; nested hierarchy)\n` +
        `  teachers:             ${TEACHERS.length}\n` +
        `  intervals seeded:     ${seededIntervals}\n` +
        `  assignments:          ${ASSIGNMENTS.length}\n` +
        `  sessions generated:   ${sessionsCreated} (until ${until})\n` +
        `  answered periods:     ${periodCount}\n` +
        `  evaluation cells:     ${cells.sessions.length} (${answered} answered)\n` +
        `  custom fields:        ${connected.fields}\n` +
        `  tasks / alerts:       ${connected.tasks + 4} / ${connected.alerts}\n` +
        `  cafe products:        ${connected.products}\n` +
        `  voice transcripts:    ${connected.transcripts}\n` +
        `  sample logins:        sample-admin/staff/viewer/accountant/kiosk\n` +
        `  sample password:      ${SAMPLE_PASSWORD}`
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const command = process.argv[2];
if (command === 'remove' || command === '--remove') {
  await removeSample();
} else if (command === undefined || command === 'add') {
  await addSample();
} else {
  fail(
    'Usage:\n  npm run seed-sample            adds sample data\n  npm run seed-sample -- remove  removes it'
  );
}
await pool.end();
