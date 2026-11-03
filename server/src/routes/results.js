import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { listAssignmentPeriods } from '../lib/periods.js';
import { buildResults } from '../lib/results.js';
import { readReportResults } from '../lib/reportResults.js';

const router = Router();

router.get('/scope', async (req, res) => {
  const ids = typeof req.query.periodIds === 'string' ? [...new Set(req.query.periodIds.split(','))] : [];
  if (ids.length === 0 || ids.length > 200 || !ids.every(isUuid)) {
    return res.status(400).json({ error: 'Choose between 1 and 200 valid periods.', code: 'REPORT_SCOPE_INVALID' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await readReportResults(client, ids);
    await client.query('COMMIT');
    res.json(result);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
});

// The results grid of one assignment period. Rows = the assignment's targets
// (whole-group row first, then members; an individual assignment has exactly
// its member), columns = parameters, cells carry both dimensions plus the
// answered state, and `previous` carries the same cells from the
// assignment's previous period (seq − 1) for the change columns.
router.get('/', async (req, res) => {
  const { assignmentId } = req.query;
  if (!isUuid(assignmentId)) {
    return res.status(400).json({
      error: 'assignmentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    });
  }
  const seqRaw = req.query.seq;
  if (!/^\d+$/.test(seqRaw ?? '') || Number(seqRaw) < 1) {
    return res.status(400).json({
      error: 'seq must be a whole number from 1.',
      code: 'VALIDATION_INVALID_RANGE',
      params: { min: 1 },
    });
  }
  const seq = Number(seqRaw);
  const dimension = req.query.dimension ?? 'quality';
  if (dimension !== 'quality' && dimension !== 'quantity') {
    return res.status(400).json({
      error: 'dimension must be "quality" or "quantity".',
      code: 'VALIDATION_INVALID_CHOICE',
      params: { field: 'dimension' },
    });
  }

  const assignmentResult = await pool.query(
    `SELECT a.id,
            a.code          AS "assignmentCode",
            a.name          AS "assignmentName",
            a.group_id      AS "groupId",
            g.name          AS "groupName",
            a.membership_id AS "assignmentMembershipId",
            t.full_name     AS "teacherName"
     FROM assignments a
     JOIN teachers t ON t.id = a.teacher_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE a.id = $1`,
    [assignmentId]
  );
  const assignment = assignmentResult.rows[0];
  if (!assignment) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }

  const periods = await listAssignmentPeriods(pool, assignmentId);
  const period = periods.find((candidate) => candidate.seq === seq);
  if (!period || period.sessionCount === 0) {
    return res.status(400).json({
      error: `Period ${seq} of this assignment has no sessions yet.`,
      code: 'PERIODS_NOT_STARTED',
      params: { seq },
    });
  }

  const periodSeqs = [seq, seq - 1].filter((value) => value >= 1);

  const [targetsResult, parametersResult, evaluationsResult] = await Promise.all([
    pool.query(
      `SELECT ms.id          AS "membershipId",
              s.id           AS "studentId",
              s.full_name    AS "fullName",
              s.student_code AS "studentCode",
              ms.joined_on::text AS "addedOn",
              ms.left_on::text AS "leftOn"
       FROM assignments a
       JOIN student_group_members ms
         ON (a.group_id IS NOT NULL AND ms.group_id = a.group_id)
         OR (a.membership_id IS NOT NULL AND ms.id = a.membership_id)
       JOIN students s ON s.id = ms.student_id
       WHERE a.id = $1
          AND s.deleted_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM sessions ps
            JOIN periods pp ON pp.id = ps.period_id AND pp.archived_at IS NULL
            WHERE ps.assignment_id = a.id
              AND pp.seq = ANY($2::int[])
              AND ps.archived_at IS NULL
              AND ps.canceled_at IS NULL
              AND ms.joined_on <= ps.session_date
              AND (ms.left_on IS NULL OR ms.left_on >= ps.session_date)
          )
       ORDER BY lower(s.full_name)`,
      [assignmentId, periodSeqs]
    ),
    pool.query(
      `SELECT id, code, name,
              min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE archived_at IS NULL
       ORDER BY sort_order, lower(name)`
    ),
    pool.query(
      `SELECT e.session_id       AS "sessionId",
              s.session_date::text AS "sessionDate",
              e.membership_id    AS "membershipId",
              e.parameter_id     AS "parameterId",
              e.quality_value    AS "qualityValue",
              e.quantity_value   AS "quantityValue",
              e.quality_comment  AS "qualityComment",
              e.quantity_comment AS "quantityComment",
              p.seq              AS "periodSeq"
       FROM evaluations e
       JOIN sessions s ON s.id = e.session_id
       JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
       WHERE s.assignment_id = $1
         AND p.seq = ANY($2::int[])
         AND s.canceled_at IS NULL
         AND s.archived_at IS NULL
         AND e.archived_at IS NULL
       ORDER BY s.session_date ASC, s.seq ASC`,
      [assignmentId, periodSeqs]
    ),
  ]);

  const targets = assignment.assignmentMembershipId
    ? targetsResult.rows.filter(
        (target) => target.membershipId === assignment.assignmentMembershipId
      )
    : targetsResult.rows;

  const built = buildResults({
    seq,
    period,
    assignment,
    parameters: parametersResult.rows,
    targets,
    groupName: assignment.groupName,
    evaluations: evaluationsResult.rows,
  });

  res.json({
    assignment: {
      id: assignment.id,
      code: assignment.assignmentCode,
      name: assignment.assignmentName,
      teacherName: assignment.teacherName,
    },
    period: {
      id: period.id,
      seq: period.seq,
      startDate: period.startDate,
      endDate: period.endDate,
    },
    dimension,
    parameters: parametersResult.rows,
    ...built,
    hasPrevious: periods.some(
      (candidate) => candidate.seq === seq - 1 && candidate.sessionCount > 0
    ),
  });
});

export default router;
