import { Router } from 'express';
import pool from '../db/pool.js';
import { descendantGroupIds } from '../lib/groups.js';
import { isUuid } from '../lib/ids.js';
import { homeOverview } from '../lib/homeOverview.js';

const router = Router();

router.get('/home', async (req, res) => {
  res.json(await homeOverview(pool));
});

// Cohort trend lines: average of one dimension per (parameter, assignment,
// period). The client labels each point with the assignment + period and can
// fall back to the period's last session date as the time axis.
router.get('/trends', async (req, res) => {
  const { groupId, dimension = 'quality' } = req.query;
  if (dimension !== 'quality' && dimension !== 'quantity') {
    return res.status(400).json({
      error: 'dimension must be "quality" or "quantity".',
      code: 'VALIDATION_INVALID_CHOICE',
      params: { field: 'dimension' },
    });
  }
  if (groupId !== undefined && !isUuid(groupId)) {
    return res.status(400).json({
      error: 'groupId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'groupId' },
    });
  }

  const valueColumn =
    dimension === 'quantity' ? 'e.quantity_value' : 'e.quality_value';

  let groupFilter = '';
  const values = [];
  if (groupId !== undefined) {
    const groupIds = await descendantGroupIds(pool, groupId);
    values.push(groupIds);
    const idx = values.length;
    groupFilter = `AND (a.group_id = ANY($${idx}::uuid[]) OR EXISTS (
      SELECT 1 FROM student_group_members gm
       WHERE gm.id = a.membership_id AND gm.group_id = ANY($${idx}::uuid[])
    ))`;
  }

  const result = await pool.query(
    `SELECT e.parameter_id  AS "parameterId",
            s.assignment_id AS "assignmentId",
            a.name          AS "assignmentName",
            p.seq           AS "periodSeq",
            round(avg(${valueColumn}), 2)::float8 AS average,
            count(*)::int   AS count,
            max(s.session_date)::text AS "lastSessionDate"
     FROM evaluations e
     JOIN sessions s ON s.id = e.session_id
     JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
      JOIN assignments a ON a.id = s.assignment_id
      JOIN student_group_members ms
        ON (ms.group_id = a.group_id OR ms.id = a.membership_id)
       AND ms.added_at::date <= s.session_date
       AND (ms.left_on IS NULL OR ms.left_on >= s.session_date)
      WHERE e.archived_at IS NULL
        AND (e.membership_id = ms.id OR (
          e.membership_id IS NULL AND a.group_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM evaluations own
            WHERE own.session_id = e.session_id AND own.parameter_id = e.parameter_id
              AND own.membership_id = ms.id AND own.archived_at IS NULL
          )
        ))
       AND s.canceled_at IS NULL
       AND s.archived_at IS NULL
       AND ${valueColumn} IS NOT NULL
       ${groupFilter}
     GROUP BY e.parameter_id, s.assignment_id, a.name, p.seq
     ORDER BY s.assignment_id, e.parameter_id, p.seq`,
    values
  );
  res.json({ trends: result.rows });
});

// The constellation's data: per-student expectation vs answer counts. An
// evaluation ROW is the expectation ("selected"); it is answered once any
// value or comment is present. Whole-group rows count for every current
// member of the group; where both a member row and a group row exist, the
// member row wins (the more specific cell).
router.get('/summary', async (req, res) => {
  const { groupId, assignmentId } = req.query;
  if (groupId !== undefined && !isUuid(groupId)) {
    return res.status(400).json({
      error: 'groupId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'groupId' },
    });
  }
  if (assignmentId !== undefined && !isUuid(assignmentId)) {
    return res.status(400).json({
      error: 'assignmentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    });
  }

  const scopeValues = [];
  const scopeConditions = ['s.canceled_at IS NULL', 's.archived_at IS NULL'];
  if (assignmentId !== undefined) {
    scopeValues.push(assignmentId);
    scopeConditions.push(`s.assignment_id = $${scopeValues.length}`);
  }
  if (groupId !== undefined) {
    const groupIds = await descendantGroupIds(pool, groupId);
    scopeValues.push(groupIds);
    const idx = scopeValues.length;
    scopeConditions.push(
      `(a.group_id = ANY($${idx}::uuid[]) OR EXISTS (
        SELECT 1 FROM student_group_members gm
         WHERE gm.id = a.membership_id AND gm.group_id = ANY($${idx}::uuid[])
      ))`
    );
  }

  // One row per (membership cell): member rows are per student; group rows
  // expand per current member. A member row shadows the group row of the
  // same (session, parameter) via NOT EXISTS.
  const cells = await pool.query(
    `WITH group_cells AS (
       SELECT e.id, e.session_id, e.parameter_id,
               evaluation_is_answered(
                 e.quality_value, e.quantity_value,
                 e.quality_comment, e.quantity_comment
               )
                 AS answered,
              ms.id AS "membershipId"
       FROM evaluations e
       JOIN sessions s ON s.id = e.session_id
       JOIN assignments a ON a.id = s.assignment_id
       JOIN student_group_members ms
          ON ms.group_id = a.group_id
         AND ms.added_at::date <= s.session_date
         AND (ms.left_on IS NULL OR ms.left_on >= s.session_date)
       WHERE e.membership_id IS NULL AND e.archived_at IS NULL
         AND ${scopeConditions.join(' AND ')}
         AND NOT EXISTS (
           SELECT 1 FROM evaluations own
           WHERE own.session_id = e.session_id
             AND own.parameter_id = e.parameter_id
             AND own.membership_id = ms.id
             AND own.archived_at IS NULL)
     ),
     member_cells AS (
       SELECT e.id, e.session_id, e.parameter_id,
               evaluation_is_answered(
                 e.quality_value, e.quantity_value,
                 e.quality_comment, e.quantity_comment
               )
                 AS answered,
              e.membership_id AS "membershipId"
       FROM evaluations e
       JOIN sessions s ON s.id = e.session_id
       JOIN assignments a ON a.id = s.assignment_id
       WHERE e.membership_id IS NOT NULL AND e.archived_at IS NULL
         AND ${scopeConditions.join(' AND ')}
     )
     SELECT ms.student_id AS "studentId", cells.answered
     FROM (
       SELECT id, session_id, parameter_id, answered, "membershipId" FROM group_cells
       UNION ALL
       SELECT id, session_id, parameter_id, answered, "membershipId" FROM member_cells
     ) cells
      JOIN student_group_members ms ON ms.id = cells."membershipId"
        AND ms.left_on IS NULL`,
    scopeValues
  );

  const rosterFilter = groupId !== undefined;
  const rosterValues = [];
  let rosterWhere = 's.deleted_at IS NULL';
  let rosterJoin = '';
  if (rosterFilter) {
    const groupIds = await descendantGroupIds(pool, groupId);
    rosterValues.push(groupIds);
    rosterJoin = `JOIN student_group_members rm
                    ON rm.student_id = s.id AND rm.group_id = ANY($1::uuid[])
                   AND rm.left_on IS NULL`;
  }

  const roster = await pool.query(
    `SELECT s.id, s.full_name AS "fullName", s.student_code AS "studentCode"
     FROM students s
     ${rosterJoin}
     WHERE ${rosterWhere}
     ORDER BY lower(s.full_name), s.id
     LIMIT 5000`,
    rosterValues
  );

  const perStudent = new Map();
  for (const cell of cells.rows) {
    const entry = perStudent.get(cell.studentId) ?? { expected: 0, answered: 0 };
    entry.expected += 1;
    if (cell.answered) entry.answered += 1;
    perStudent.set(cell.studentId, entry);
  }

  const students = roster.rows.map((student) => {
    const counts = perStudent.get(student.id) ?? { expected: 0, answered: 0 };
    const state =
      counts.expected === 0 || counts.answered === 0
        ? 'none'
        : counts.answered >= counts.expected
          ? 'full'
          : 'partial';
    return {
      id: student.id,
      fullName: student.fullName,
      studentCode: student.studentCode,
      expected: counts.expected,
      answered: counts.answered,
      state,
    };
  });

  res.json({
    students,
    totals: {
      expected: students.reduce((sum, student) => sum + student.expected, 0),
      answered: students.reduce((sum, student) => sum + student.answered, 0),
    },
  });
});

export default router;
