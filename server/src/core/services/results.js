// Results (assignment-period grid) — service layer (framework-free).
//
// PGlite test mirror of routes/results.js under the schema-4 model: one
// assignment period's grid — rows are the assignment's targets (whole-group
// row first, then members; an individual assignment has exactly its member),
// columns are parameters, cells carry both dimensions plus the answered
// state, and `previous` carries the same cells from the assignment's previous
// period (seq − 1) for the change columns. No audit, no req.user (it was a
// pure GET), so the conversion is pool→getDb(), status codes→ServiceError,
// and query-string coercion done explicitly.
//
// `input` = { assignmentId, seq, dimension? }. Returns
// { assignment, period, dimension, parameters, ...buildResults(...), hasPrevious }.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { isUuid } from '../../lib/ids.js';
import { listAssignmentPeriods } from '../../lib/periods.js';
import { buildResults } from '../../lib/results.js';

export async function getResults(input = {}) {
  const db = getDb();
  const { assignmentId, seq: rawSeq, dimension = 'quality' } = input;

  if (!isUuid(assignmentId)) {
    throw ServiceError.validation('assignmentId must be a valid ID.');
  }
  const seq = Number(rawSeq);
  if (!Number.isInteger(seq) || seq < 1) {
    throw ServiceError.validation('seq must be a whole number from 1.');
  }
  if (dimension !== 'quality' && dimension !== 'quantity') {
    throw ServiceError.validation('dimension must be "quality" or "quantity".');
  }

  const assignmentResult = await db.query(
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
    throw ServiceError.notFound('Assignment not found.');
  }

  const periods = await listAssignmentPeriods(db, assignmentId);
  const period = periods.find((candidate) => candidate.seq === seq);
  if (!period || period.sessionCount === 0) {
    throw ServiceError.validation(
      `Period ${seq} of this assignment has no sessions yet.`,
      { code: 'PERIODS_NOT_STARTED', params: { seq } }
    );
  }

  const periodSeqs = [seq, seq - 1].filter((value) => value >= 1);

  const [targetsResult, parametersResult, evaluationsResult] = await Promise.all([
    db.query(
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
    db.query(
      `SELECT id, code, name,
              min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE archived_at IS NULL
       ORDER BY sort_order, lower(name)`
    ),
    db.query(
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

  return {
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
  };
}
