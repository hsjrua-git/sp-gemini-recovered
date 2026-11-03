import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { parseAssignmentBody } from '../validation/schedule.js';
import { recordAudit } from '../lib/audit.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

const ASSIGNMENT_COLUMNS = `
  a.id,
  a.code,
  a.name,
  a.teacher_id    AS "teacherId",
  t.full_name     AS "teacherName",
  a.interval_id   AS "intervalId",
  i.name          AS "intervalName",
  i.every         AS "every",
  a.group_id      AS "groupId",
  g.name          AS "groupName",
  a.membership_id AS "membershipId",
  ms.student_id   AS "studentId",
  ms.group_id     AS "studentGroupId",
  sf.full_name    AS "studentName",
  msg.name            AS "studentGroupName",
  a.anchor_date::text AS "anchorDate",
  a.sort_order        AS "sortOrder",
  a.archived_at   AS "archivedAt",
  a.created_at    AS "createdAt"
`;

const ASSIGNMENT_FROM = `
  FROM assignments a
  JOIN teachers t ON t.id = a.teacher_id
  JOIN intervals i ON i.id = a.interval_id
  LEFT JOIN student_groups g ON g.id = a.group_id
  LEFT JOIN student_group_members ms ON ms.id = a.membership_id
  LEFT JOIN students sf ON sf.id = ms.student_id
  LEFT JOIN student_groups msg ON msg.id = ms.group_id
`;

// The teacher, interval and target an update touches (or an un-archived
// assignment keeps) must still be active. Returns an error object or null.
async function checkReferences(db, updates, { reactivating = false } = {}) {
  if (!reactivating && updates.teacherId === undefined &&
      updates.intervalId === undefined && updates.groupId === undefined &&
      updates.membershipId === undefined) {
    return null;
  }

  const teacherId = updates.teacherId;
  if (teacherId != null) {
    const result = await db.query(
      'SELECT archived_at FROM teachers WHERE id = $1',
      [teacherId]
    );
    if (result.rowCount === 0 || result.rows[0].archived_at !== null) {
      return {
        error: 'Choose an active teacher.',
        code: 'ASSIGNMENTS_TEACHER_INACTIVE',
      };
    }
  }

  const intervalId = updates.intervalId;
  if (intervalId != null) {
    const result = await db.query(
      'SELECT archived_at FROM intervals WHERE id = $1',
      [intervalId]
    );
    if (result.rowCount === 0 || result.rows[0].archived_at !== null) {
      return {
        error: 'Choose an active interval.',
        code: 'ASSIGNMENTS_INTERVAL_INACTIVE',
      };
    }
  }

  const groupId = updates.groupId;
  if (groupId != null) {
    const result = await db.query(
      'SELECT archived_at FROM student_groups WHERE id = $1',
      [groupId]
    );
    if (result.rowCount === 0 || result.rows[0].archived_at !== null) {
      return {
        error: 'Choose an active group.',
        code: 'ASSIGNMENTS_GROUP_INACTIVE',
      };
    }
  }

  const membershipId = updates.membershipId;
  if (membershipId != null) {
    // An individual target must be an open membership of a live student in a
    // live group.
    const result = await db.query(
      `SELECT ms.left_on, s.deleted_at, g2.archived_at
       FROM student_group_members ms
       JOIN students s ON s.id = ms.student_id
       JOIN student_groups g2 ON g2.id = ms.group_id
       WHERE ms.id = $1`,
      [membershipId]
    );
    const row = result.rows[0];
    if (
      result.rowCount === 0 ||
      row.left_on !== null ||
      row.deleted_at !== null ||
      row.archived_at !== null
    ) {
      return {
        error: 'Choose a student who is currently in a live group.',
        code: 'ASSIGNMENTS_MEMBERSHIP_INACTIVE',
      };
    }
  }

  return null;
}

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }
  next();
});

// Open memberships of one student, for picking an individual assignment
// target in the schedule form.
router.get('/memberships', async (req, res) => {
  const { studentId } = req.query;
  if (!isUuid(studentId)) {
    return res.status(400).json({
      error: 'studentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'studentId' },
    });
  }
  const result = await pool.query(
    `SELECT m.id AS "membershipId", m.group_id AS "groupId", g.name AS "groupName"
     FROM student_group_members m
     JOIN student_groups g ON g.id = m.group_id
     WHERE m.student_id = $1 AND m.left_on IS NULL AND g.archived_at IS NULL
     ORDER BY lower(g.name)`,
    [studentId]
  );
  res.json({ memberships: result.rows });
});

router.get('/targets', async (req, res) => {
  const result = await pool.query(
    `SELECT ms.id, ms.group_id AS "groupId", s.id AS "studentId",
            s.full_name AS "fullName", s.student_code AS "studentCode"
     FROM student_group_members ms JOIN students s ON s.id = ms.student_id
     JOIN student_groups g ON g.id = ms.group_id
     WHERE ms.left_on IS NULL AND s.deleted_at IS NULL AND g.archived_at IS NULL
     ORDER BY lower(s.full_name) LIMIT 5001`
  );
  res.json({ memberships: result.rows.slice(0, 5000), truncated: result.rowCount > 5000 });
});

router.post('/bulk', async (req, res) => {
  const { groupIds = [], membershipIds = [], ...fields } = req.body ?? {};
  if (![groupIds, membershipIds].every(ids => Array.isArray(ids) && ids.every(isUuid)) ||
      groupIds.length + membershipIds.length < 1 || groupIds.length + membershipIds.length > 200) {
    return res.status(400).json({ error: 'Choose 1 to 200 group or student targets.', code: 'WORKFLOW_TARGETS_INVALID' });
  }
  const targets = [...new Set(groupIds)].map(groupId => ({ groupId }))
    .concat([...new Set(membershipIds)].map(membershipId => ({ membershipId })));
  const parsed = targets.map(target => parseAssignmentBody({ ...fields, ...target, code: null }));
  const invalid = parsed.find(item => item.error);
  if (invalid) return res.status(400).json(invalid);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const ids = [];
    for (const item of parsed) {
      const a = item.value;
      const invalidRef = await checkReferences(client, a);
      if (invalidRef) { await client.query('ROLLBACK'); return res.status(400).json(invalidRef); }
      const created = await client.query(
        `INSERT INTO assignments (code, name, teacher_id, interval_id, group_id, membership_id, anchor_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date) RETURNING id`,
        [null, a.name, a.teacherId, a.intervalId, a.groupId ?? null, a.membershipId ?? null, a.anchorDate]
      );
      ids.push(created.rows[0].id);
    }
    await recordAudit(client, { userId: req.user.id, actor: req.user.username, action: 'assignment.create_bulk', entityType: 'assignment', details: { ids, targets } });
    await client.query('COMMIT');
    res.status(201).json({ created: ids.length, ids });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'A selected target already has this schedule. No assignments were created.', code: 'ASSIGNMENTS_DUPLICATE_SCHEDULE' });
    if (['23503', '23514', '22P02'].includes(error.code)) return res.status(400).json({ error: 'Choose valid active targets, teacher and interval.', code: 'WORKFLOW_TARGETS_INVALID' });
    throw error;
  } finally { client.release(); }
});

router.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const { teacherId, groupId } = req.query;

  const conditions = [includeArchived ? 'TRUE' : 'a.archived_at IS NULL'];
  const values = [];
  if (teacherId !== undefined) {
    if (!isUuid(teacherId)) {
      return res.status(400).json({
        error: 'teacherId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'teacherId' },
      });
    }
    values.push(teacherId);
    conditions.push(`a.teacher_id = $${values.length}`);
  }
  if (groupId !== undefined) {
    if (!isUuid(groupId)) {
      return res.status(400).json({
        error: 'groupId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'groupId' },
      });
    }
    values.push(groupId);
    conditions.push(`a.group_id = $${values.length}`);
  }
  const where = conditions.join(' AND ');

  const result = await pool.query(
    `SELECT ${ASSIGNMENT_COLUMNS}
     ${ASSIGNMENT_FROM}
     WHERE ${where}
     ORDER BY a.archived_at IS NOT NULL, a.sort_order, lower(coalesce(a.name, a.code)), a.code`,
    values
  );
  res.json({ assignments: result.rows });
});

router.post('/', async (req, res) => {
  const parsed = parseAssignmentBody(req.body ?? {});
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const assignment = parsed.value;

  const refError = await checkReferences(pool, assignment);
  if (refError) {
    return res.status(400).json({
      error: refError.error,
      code: refError.code,
      params: refError.params,
    });
  }

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await pool.query(
        `INSERT INTO assignments
           (code, name, teacher_id, interval_id, group_id, membership_id, anchor_date, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8)
         RETURNING id`,
        [
          assignment.code,
          assignment.name,
          assignment.teacherId,
          assignment.intervalId,
          assignment.groupId ?? null,
          assignment.membershipId ?? null,
          assignment.anchorDate,
          assignment.sortOrder ?? 0,
        ]
      );
      const full = await pool.query(
        `SELECT ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} WHERE a.id = $1`,
        [result.rows[0].id]
      );
      return res.status(201).json({ assignment: full.rows[0] });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      if (err.constraint === 'assignments_code_unique' && assignment.code === null) {
        continue; // Re-evaluate the database-generated suffix after a collision.
      }
      return res.status(409).json({
        error:
          'This teacher already has a schedule with that interval for the same target.',
        code: 'ASSIGNMENTS_DUPLICATE_SCHEDULE',
      });
    }
  }

  res.status(500).json({
    error: 'Could not create a unique assignment code.',
    code: 'ASSIGNMENTS_CODE_GENERATION_FAILED',
  });
});

router.patch('/:id', async (req, res) => {
  const parsed = parseAssignmentBody(req.body ?? {}, { partial: true });
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }
  const updates = parsed.value;

  const existing = await pool.query(
    `SELECT id, archived_at AS "archivedAt", group_id AS "groupId",
            membership_id AS "membershipId"
     FROM assignments WHERE id = $1`,
    [req.params.id]
  );
  if (existing.rowCount === 0) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }

  // Whatever combination of target keys the update carries, the row must end
  // with exactly one non-null target — check against the stored pair so a
  // partial update cannot quietly blank both sides.
  const current = existing.rows[0];
  const finalGroupId =
    'groupId' in updates ? updates.groupId : current.groupId;
  const finalMembershipId =
    'membershipId' in updates ? updates.membershipId : current.membershipId;
  if ((finalGroupId !== null) === (finalMembershipId !== null)) {
    return res.status(400).json({
      error: 'Choose exactly one target: a group or a single student.',
      code: 'ASSIGNMENTS_TARGET_REQUIRED',
    });
  }

  const reactivating = updates.archived === false && existing.rows[0].archivedAt !== null;
  const refError = await checkReferences(pool, updates, { reactivating });
  if (refError) {
    return res.status(400).json({
      error: refError.error,
      code: refError.code,
      params: refError.params,
    });
  }
  // Re-validate the kept references when bringing an assignment back: pass
  // the stored values through the same checks.
  if (reactivating) {
    const kept = await pool.query(
      `SELECT teacher_id AS "teacherId", interval_id AS "intervalId",
              group_id AS "groupId", membership_id AS "membershipId"
       FROM assignments WHERE id = $1`,
      [req.params.id]
    );
    const refError2 = await checkReferences(pool, kept.rows[0], { reactivating });
    if (refError2) {
      return res.status(400).json({
        error: refError2.error,
        code: refError2.code,
        params: refError2.params,
      });
    }
  }

  const COLUMN_OF = {
    code: ['code', null],
    name: ['name', null],
    teacherId: ['teacher_id', null],
    intervalId: ['interval_id', null],
    groupId: ['group_id', null],
    membershipId: ['membership_id', null],
    anchorDate: ['anchor_date', '::date'],
    sortOrder: ['sort_order', null],
  };
  const sets = [];
  const values = [];
  for (const [field, value] of Object.entries(updates)) {
    if (field === 'archived') continue;
    const [column, cast] = COLUMN_OF[field];
    values.push(value);
    sets.push(`${column} = $${values.length}${cast ?? ''}`);
  }
  if ('archived' in updates) {
    sets.push(`archived_at = ${updates.archived ? 'now()' : 'NULL'}`);
  }

  values.push(req.params.id);
  let updated;
  try {
    const result = await pool.query(
      `UPDATE assignments
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id`,
      values
    );
    updated = result.rows[0];
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error:
          'This teacher already has a schedule with that interval for the same target.',
        code: 'ASSIGNMENTS_DUPLICATE_SCHEDULE',
      });
    }
    throw err;
  }
  if (!updated) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }
  const full = await pool.query(
    `SELECT ${ASSIGNMENT_COLUMNS} ${ASSIGNMENT_FROM} WHERE a.id = $1`,
    [req.params.id]
  );
  res.json({ assignment: full.rows[0] });
});

// DELETE archives; the code and history stay reserved.
router.delete('/:id', async (req, res) => {
  const result = await pool.query(
    `UPDATE assignments SET archived_at = now()
     WHERE id = $1 AND archived_at IS NULL
     RETURNING id`,
    [req.params.id]
  );
  if (result.rowCount === 0) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }
  res.status(204).end();
});

export default router;
