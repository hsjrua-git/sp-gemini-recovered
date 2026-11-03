import { Router } from 'express';
import pool from '../db/pool.js';
import { isValidIsoDate } from '../lib/periods.js';
import { descendantGroupIds } from '../lib/groups.js';
import { isUuid } from '../lib/ids.js';
import { MAX_EXPORT_STUDENTS, buildCube } from '../lib/exportCube.js';
import { readReportExport } from '../lib/reportExport.js';

const router = Router();

// Guard against an absurd number of ids in one request (the arrays are passed
// straight into `= ANY($n::uuid[])`, so this bounds the query too).
const MAX_IDS = 5000;

// Accept either an array (POST JSON body) or a comma-separated string (GET query
// string) and return a clean array of trimmed, non-empty strings.
function normalizeList(raw) {
  if (Array.isArray(raw)) return raw.map((value) => String(value).trim()).filter(Boolean);
  if (typeof raw === 'string') {
    return raw
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [];
}

// The cube: any student × parameter × (assignment, period) slice in one
// request; a session-date range can narrow it further. Both GET
// (comma-separated ids in the query string) and POST (id arrays in the body,
// for selections too large for a URL) run this. Whole-group evaluation rows
// expand to one cell per current member (a member's own row shadows the group
// row), so the cube stays strictly student-shaped. Custom student fields are
// deliberately NOT part of the scores cube — the roster export on the
// Students page already covers those, and leaving them out keeps this route
// clear of the `fields.view_restricted` gate.
async function handleCube(req, res) {
  const source = req.method === 'POST' ? req.body ?? {} : req.query;

  const { groupId, assignmentId } = source;
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

  const studentIds = normalizeList(source.studentIds);
  if (studentIds.length > MAX_IDS) {
    return res.status(400).json({
      error: `Too many students requested (max ${MAX_IDS}).`,
      code: 'EXPORT_TOO_MANY_IDS',
      params: { field: 'studentIds', max: MAX_IDS },
    });
  }
  if (studentIds.some((id) => !isUuid(id))) {
    return res.status(400).json({
      error: 'studentIds must all be valid IDs.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'studentIds' },
    });
  }

  const parameterIds = normalizeList(source.parameterIds);
  if (parameterIds.length > MAX_IDS) {
    return res.status(400).json({
      error: `Too many parameters requested (max ${MAX_IDS}).`,
      code: 'EXPORT_TOO_MANY_IDS',
      params: { field: 'parameterIds', max: MAX_IDS },
    });
  }
  if (parameterIds.some((id) => !isUuid(id))) {
    return res.status(400).json({
      error: 'parameterIds must all be valid IDs.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'parameterIds' },
    });
  }
  const selectedParameterIds = parameterIds.length > 0 ? parameterIds : null;

  const { from, to } = source;
  if (from !== undefined && !isValidIsoDate(from)) {
    return res.status(400).json({
      error: 'from must be a date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
      params: { field: 'from' },
    });
  }
  if (to !== undefined && !isValidIsoDate(to)) {
    return res.status(400).json({
      error: 'to must be a date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
      params: { field: 'to' },
    });
  }

  if (source.periodIds !== undefined) {
    const periodIds = normalizeList(source.periodIds);
    if (!periodIds.length || periodIds.length > 200 || !periodIds.every(isUuid)) {
      return res.status(400).json({ error: 'Choose between 1 and 200 valid periods.', code: 'REPORT_SCOPE_INVALID' });
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const result = await readReportExport(client, periodIds, { studentIds, parameterIds, from, to });
      await client.query('COMMIT');
      return res.json(result);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  // Period narrowing (per assignment seq) only makes sense with one assignment.
  let seqs = null;
  if (source.periods !== undefined) {
    if (assignmentId === undefined) {
      return res.status(400).json({
        error: 'periods requires assignmentId (seq numbers are per assignment).',
        code: 'VALIDATION_REQUIRED',
        params: { field: 'assignmentId' },
      });
    }
    const numbers = normalizeList(source.periods)
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1);
    if (numbers.length === 0) {
      return res.status(400).json({
        error: 'Select at least one period.',
        code: 'VALIDATION_REQUIRED',
        params: { field: 'periods' },
      });
    }
    seqs = [...new Set(numbers)].sort((a, b) => a - b);
  }

  // Build the roster filter. A specific selection wins over a group; otherwise
  // the whole (non-deleted) roster, bounded by the export cap.
  const filters = [];
  const values = [];
  if (studentIds.length > 0) {
    values.push(studentIds);
    filters.push(`s.id = ANY($${values.length}::uuid[])`);
  } else if (groupId !== undefined) {
    const groupIds = await descendantGroupIds(pool, groupId);
    values.push(groupIds);
    filters.push(
      `s.id IN (SELECT student_id FROM student_group_members
                WHERE group_id = ANY($${values.length}::uuid[]) AND left_on IS NULL)`
    );
  }
  const rosterWhere = ['s.deleted_at IS NULL', ...filters].join(' AND ');

  const [studentsResult, countResult] = await Promise.all([
    pool.query(
      `SELECT s.id,
              s.full_name    AS "fullName",
              s.student_code AS "studentCode"
       FROM students s
       WHERE ${rosterWhere}
       ORDER BY lower(s.full_name), s.id
       LIMIT $${values.length + 1}`,
      [...values, MAX_EXPORT_STUDENTS]
    ),
    pool.query(`SELECT count(*)::int AS total FROM students s WHERE ${rosterWhere}`, values),
  ]);
  const rosterIds = studentsResult.rows.map((student) => student.id);

  // Cell filters: the scope filters run against the `expanded` output (the
  // branches have already excluded archived rows/canceled+archived sessions
  // and sessions outside an active persisted period.
  const cellValues = [rosterIds];
  const cellFilters = [
    `cell_student.id = ANY($1::uuid[])`,
  ];
  if (assignmentId !== undefined) {
    cellValues.push(assignmentId);
    cellFilters.push(`expanded."assignmentId" = $${cellValues.length}`);
  }
  if (seqs) {
    cellValues.push(seqs);
    cellFilters.push(`expanded.seq = ANY($${cellValues.length}::int[])`);
  }
  if (from !== undefined) {
    cellValues.push(from);
    cellFilters.push(`expanded."sessionDate" >= $${cellValues.length}::date`);
  }
  if (to !== undefined) {
    cellValues.push(to);
    cellFilters.push(`expanded."sessionDate" <= $${cellValues.length}::date`);
  }
  if (selectedParameterIds) {
    cellValues.push(selectedParameterIds);
    cellFilters.push(`expanded."parameterId" = ANY($${cellValues.length}::uuid[])`);
  }

  const cellsResult = await pool.query(
    `WITH expanded AS (
       -- Whole-group rows: one cell per current member of the target group,
       -- except where the member has their own row for the same cell.
       SELECT e.id, e.parameter_id   AS "parameterId",
              e.quality_value   AS "qualityValue",
               e.quantity_value  AS "quantityValue",
               ms.id AS "membershipId", ms.student_id AS "studentId",
               s.assignment_id   AS "assignmentId",
               p.seq, s.seq AS "sessionSeq",
               s.session_date::text AS "sessionDate",
               true AS "viaGroup"
        FROM evaluations e
        JOIN sessions s ON s.id = e.session_id
        JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
        JOIN assignments a ON a.id = s.assignment_id
        JOIN student_group_members ms
          ON ms.group_id = a.group_id
         AND ms.joined_on <= s.session_date
         AND (ms.left_on IS NULL OR ms.left_on >= s.session_date)
        WHERE e.archived_at IS NULL
          AND s.canceled_at IS NULL
          AND s.archived_at IS NULL
          AND e.membership_id IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM evaluations own
           WHERE own.session_id = e.session_id
             AND own.parameter_id = e.parameter_id
             AND own.membership_id = ms.id
             AND own.archived_at IS NULL)
       UNION ALL
       SELECT e.id, e.parameter_id,
              e.quality_value,
               e.quantity_value, e.membership_id,
               ms.student_id, s.assignment_id, p.seq, s.seq,
               s.session_date::text, false
        FROM evaluations e
        JOIN sessions s ON s.id = e.session_id
        JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
        JOIN student_group_members ms ON ms.id = e.membership_id
        WHERE e.archived_at IS NULL
          AND s.canceled_at IS NULL
          AND s.archived_at IS NULL
          AND e.membership_id IS NOT NULL
     )
     SELECT expanded."parameterId"   AS "parameterId",
            expanded."studentId"     AS "studentId",
             expanded."assignmentId"  AS "assignmentId",
             expanded.seq             AS "periodSeq",
             expanded."sessionSeq",
             expanded."sessionDate",
            expanded."qualityValue"  AS quality,
            expanded."quantityValue" AS quantity,
            expanded."viaGroup"
     FROM expanded
     JOIN students cell_student ON cell_student.id = expanded."studentId"
     WHERE ${cellFilters.join(' AND ')}
      ORDER BY expanded."sessionDate", expanded."sessionSeq", expanded."parameterId"`,
    cellValues
  );

  // Metadata: the assignments and period buckets present in the slice.
  const assignmentsResult = await pool.query(
    `SELECT DISTINCT a.id, a.code, a.name
     FROM assignments a
     JOIN sessions s ON s.assignment_id = a.id
     WHERE ($1::uuid IS NULL OR a.id = $1)`,
    [assignmentId ?? null]
  );
  const periodsResult = await pool.query(
    `SELECT assignment_id AS "assignmentId",
            seq,
            started_on::text AS "startDate",
            ended_on::text AS "endDate"
     FROM period_summary
     WHERE sessions_count > 0
       AND ($1::uuid IS NULL OR assignment_id = $1)
     ORDER BY assignment_id, seq`,
    [assignmentId ?? null]
  );

  const cube = buildCube({
    parameters: (await pool.query(
      `SELECT id, code, name,
              min_value AS "minValue", max_value AS "maxValue",
              archived_at AS "archivedAt"
       FROM parameters
       ORDER BY sort_order, lower(name)`
    )).rows,
    students: studentsResult.rows,
    assignments: assignmentsResult.rows,
    periods: periodsResult.rows,
    cells: cellsResult.rows,
    selectedParameterIds,
  });

  const total = countResult.rows[0].total;
  res.json({
    ...cube,
    total,
    truncated: total > rosterIds.length,
  });
}

router.get('/cube', handleCube);
router.post('/cube', handleCube);

export default router;
