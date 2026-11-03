import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import {
  cellKey,
  findLockedChanges,
  parseOverrideReason,
} from '../lib/locks.js';
import { effectiveEntry, writeEvaluationCell } from '../lib/evaluationCell.js';
import { userCan } from '../middleware/auth.js';
import {
  findProblems,
  normalizeComment,
  validateShape,
} from '../lib/evaluationCheck.js';
import { previewCells, previewCounts } from '../lib/scorePreview.js';

const router = Router();

// The assignment's valid evaluation targets: for a group assignment every
// open membership of the group (plus the whole-group row), for an individual
// assignment exactly its own member. Maps membershipId → student info.
async function loadTargets(db, assignment) {
  if (assignment.assignmentMembershipId) {
    const result = await db.query(
      `SELECT ms.id            AS "membershipId",
              s.id             AS "studentId",
              s.full_name      AS "fullName",
              s.student_code   AS "studentCode"
       FROM student_group_members ms
       JOIN students s ON s.id = ms.student_id
       JOIN student_groups g ON g.id = ms.group_id AND g.archived_at IS NULL
       WHERE ms.id = $1
         AND ms.joined_on <= $2::date
         AND (ms.left_on IS NULL OR ms.left_on >= $2::date)
         AND s.deleted_at IS NULL`,
      [assignment.assignmentMembershipId, assignment.sessionDate]
    );
    return new Map(result.rows.map((row) => [row.membershipId, row]));
  }
  const result = await db.query(
    `SELECT ms.id         AS "membershipId",
            s.id          AS "studentId",
            s.full_name   AS "fullName",
            s.student_code AS "studentCode"
     FROM student_group_members ms
     JOIN students s ON s.id = ms.student_id
     JOIN student_groups g ON g.id = ms.group_id AND g.archived_at IS NULL
     WHERE ms.group_id = $1
       AND ms.joined_on <= $2::date
       AND (ms.left_on IS NULL OR ms.left_on >= $2::date)
       AND s.deleted_at IS NULL
     ORDER BY lower(s.full_name)`,
    [assignment.groupId, assignment.sessionDate]
  );
  return new Map(result.rows.map((row) => [row.membershipId, row]));
}

const EVALUATION_SELECT = `
  SELECT e.id,
         e.session_id                    AS "sessionId",
         s.assignment_id                 AS "assignmentId",
         s.code                          AS "sessionCode",
         s.seq                           AS "sessionSeq",
         s.session_date::text            AS "sessionDate",
         p.seq                           AS "periodSeq",
         e.parameter_id                  AS "parameterId",
         e.membership_id                 AS "membershipId",
          ms.student_id::text             AS "studentId",
          st.full_name AS "studentName",
          parameter.name AS "parameterName",
         e.quality_value                 AS "qualityValue",
         e.quantity_value                AS "quantityValue",
         e.quality_comment               AS "qualityComment",
         e.quantity_comment              AS "quantityComment",
         e.locks_at                      AS "locksAt",
          COALESCE(e.locks_at <= now(), false) AS "isLocked",
          e.first_answered_at AS "firstAnsweredAt",
          e.archived_at AS "archivedAt",
         e.updated_at                    AS "updatedAt"
  FROM evaluations e
  JOIN sessions s ON s.id = e.session_id
  LEFT JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
   LEFT JOIN student_group_members ms ON ms.id = e.membership_id
   LEFT JOIN students st ON st.id = ms.student_id
   JOIN parameters parameter ON parameter.id = e.parameter_id
`;

// History and grid reads. Filters combine; at least one is required so the
// endpoint can never become a full-table dump.
router.get('/evaluations', async (req, res) => {
  const { sessionId, assignmentId, studentId, parameterId } = req.query;
  const conditions = [req.query.includeArchived === '1' ? 'true' : 'e.archived_at IS NULL'];
  const values = [];

  if (sessionId !== undefined) {
    if (!isUuid(sessionId)) {
      return res.status(400).json({
        error: 'sessionId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'sessionId' },
      });
    }
    values.push(sessionId);
    conditions.push(`e.session_id = $${values.length}`);
  }
  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      return res.status(400).json({
        error: 'assignmentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'assignmentId' },
      });
    }
    values.push(assignmentId);
    conditions.push(`s.assignment_id = $${values.length}`);
  }
  if (parameterId !== undefined) {
    if (!isUuid(parameterId)) {
      return res.status(400).json({
        error: 'parameterId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'parameterId' },
      });
    }
    values.push(parameterId);
    conditions.push(`e.parameter_id = $${values.length}`);
  }
  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      return res.status(400).json({
        error: 'studentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'studentId' },
      });
    }
    // The student's own member rows AND the whole-group rows of any group
    // they are (or were) a member of — both kinds concern them.
    values.push(studentId);
    conditions.push(
      `(e.membership_id IN (SELECT id FROM student_group_members WHERE student_id = $${values.length})
        OR (e.membership_id IS NULL AND EXISTS (
               SELECT 1 FROM assignments a2
               JOIN student_group_members m2 ON m2.group_id = a2.group_id
               WHERE a2.id = s.assignment_id
                 AND m2.student_id = $${values.length}
                 AND m2.joined_on <= s.session_date
                 AND (m2.left_on IS NULL OR m2.left_on >= s.session_date))))`
    );
  }

  if (values.length === 0) {
    return res.status(400).json({
      error:
        'Add at least one filter: sessionId, assignmentId, studentId or parameterId.',
      code: 'EVALUATIONS_FILTER_REQUIRED',
    });
  }

  const result = await pool.query(
    `${EVALUATION_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.seq, e.parameter_id, e.membership_id NULLS FIRST
     LIMIT 20000`,
    values
  );
  res.json({ evaluations: result.rows });
});

router.put('/evaluations/bulk', async (req, res) => {
  const {
    sessionId,
    entries,
    overrideReason: reasonInput,
    dryRun = false,
    source,
  } = req.body ?? {};

  if (typeof dryRun !== 'boolean') {
    return res.status(400).json({
      error: 'dryRun must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    });
  }
  if (source !== undefined && source !== 'import') {
    return res.status(400).json({
      error: 'Unknown source.',
      code: 'VALIDATION_INVALID_CHOICE',
    });
  }
  if (!isUuid(sessionId)) {
    return res.status(400).json({
      error: 'sessionId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'sessionId' },
    });
  }
  const shapeError = validateShape(entries, { patch: source === 'import' });
  if (shapeError) {
    return res.status(400).json({
      error: shapeError,
      code: 'EVALUATIONS_INVALID_SHAPE',
    });
  }
  // Normalise comments now so every later comparison uses the clean value.
  for (const entry of entries) {
    if ('qualityComment' in entry) {
      entry.qualityComment = normalizeComment(entry.qualityComment);
    }
    if ('quantityComment' in entry) {
      entry.quantityComment = normalizeComment(entry.quantityComment);
    }
  }

  const sessionResult = await pool.query(
    `SELECT s.id,
            s.code                  AS "sessionCode",
            s.session_date::text    AS "sessionDate",
            s.canceled_at           AS "canceledAt",
            s.archived_at           AS "archivedAt",
            a.group_id              AS "groupId",
             a.membership_id         AS "assignmentMembershipId",
             a.code                  AS "assignmentCode",
             a.name                  AS "assignmentName",
             a.archived_at           AS "assignmentArchivedAt",
             g.archived_at           AS "groupArchivedAt"
     FROM sessions s
     JOIN assignments a ON a.id = s.assignment_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) {
    return res.status(404).json({
      error: 'Session not found.',
      code: 'NOT_FOUND',
      params: { entity: 'session' },
    });
  }
  if (
    session.canceledAt ||
    session.archivedAt ||
    session.assignmentArchivedAt ||
    session.groupArchivedAt
  ) {
    return res.status(409).json({
      error: 'This session is canceled or archived; its cells cannot change.',
      code: 'SESSIONS_NOT_ACTIVE',
    });
  }

  const [targets, parametersResult] = await Promise.all([
    loadTargets(pool, session),
    pool.query(
      `SELECT id, name, min_value AS "minValue", max_value AS "maxValue"
       FROM parameters
       WHERE archived_at IS NULL`
    ),
  ]);
  const parameters = new Map(
    parametersResult.rows.map((parameter) => [parameter.id, parameter])
  );

  // An individual assignment's rows must target its own member (never the
  // whole group — a one-student schedule has no "group" to evaluate).
  if (session.assignmentMembershipId && entries.some((e) => e.membershipId === null)) {
    return res.status(400).json({
      error:
        'This assignment targets a single student; whole-group rows are not allowed.',
      code: 'EVALUATIONS_TARGET_MISMATCH',
    });
  }

  const problems = findProblems({ entries, parameters, memberships: targets });

  if (dryRun) {
    const existingResult = await pool.query(
      `SELECT membership_id       AS "membershipId",
              parameter_id        AS "parameterId",
              quality_value       AS "qualityValue",
              quantity_value      AS "quantityValue",
              quality_comment     AS "qualityComment",
              quantity_comment    AS "quantityComment",
              locks_at            AS "locksAt",
               COALESCE(locks_at <= now(), false) AS "isLocked",
               archived_at AS "archivedAt"
       FROM evaluations
        WHERE session_id = $1`,
      [sessionId]
    );
    const existing = new Map(
      existingResult.rows.map((row) => [
        cellKey(row.membershipId, row.parameterId),
        row,
      ])
    );
    // A blind-entry role (scores.enter but not scores.view) gets a redacted
    // preview: it may confirm what it is about to write, but never reads the
    // existing scores back. See previewCells + lib/permissions.js.
    const canViewScores = userCan(req, 'scores.view');
    const cells = previewCells({
      entries,
      existing,
      problemIndexes: new Set(problems.map((problem) => problem.index)),
      canViewScores,
      patch: source === 'import',
    });
    return res.json({
      dryRun: true,
      sessionId,
      cells,
      problems,
      counts: previewCounts(cells, problems),
      ...(canViewScores ? {} : { redacted: true }),
    });
  }

  if (problems.length > 0) {
    return res.status(400).json({
      error: 'Some entries are invalid. Nothing was saved.',
      code: 'EVALUATIONS_INVALID_ENTRIES',
      problems,
    });
  }

  const changes = [];
  const snapshots = { old: [], new: [] };
  let overrideReason = null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');

    const existingResult = await client.query(
      `SELECT id,
              membership_id       AS "membershipId",
              parameter_id        AS "parameterId",
              quality_value       AS "qualityValue",
              quantity_value      AS "quantityValue",
              quality_comment     AS "qualityComment",
              quantity_comment    AS "quantityComment",
              locks_at            AS "locksAt",
               COALESCE(locks_at <= now(), false) AS "isLocked",
               archived_at AS "archivedAt"
       FROM evaluations
        WHERE session_id = $1
       ORDER BY membership_id NULLS FIRST, parameter_id
       FOR UPDATE`,
      [sessionId]
    );
    const existing = new Map(
      existingResult.rows.map((row) => [
        cellKey(row.membershipId, row.parameterId),
        row,
      ])
    );

    const lockedChanges = findLockedChanges({
      entries, existing, canViewScores: userCan(req, 'scores.view'), patch: source === 'import',
    });
    const overriddenKeys = new Set(
      lockedChanges.map((item) =>
        cellKey(item.membershipId, item.parameterId)
      )
    );

    if (lockedChanges.length > 0) {
      const lockedProblems = (message) =>
        lockedChanges.map((item) => ({
          index: item.index,
          membershipId: item.membershipId,
          parameterId: item.parameterId,
          message,
        }));

      if (!userCan(req, 'scores.override')) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Some scores are locked. Nothing was saved.',
          code: 'LOCKED',
          problems: lockedProblems('Locked. Only an administrator can change it.'),
        });
      }

      const reason = parseOverrideReason(reasonInput);
      if (reason.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: reason.error,
          code: 'OVERRIDE_REASON_REQUIRED',
          problems: lockedProblems('Locked. Changing it needs a written reason.'),
        });
      }
      overrideReason = reason.value;
    }
    if (overrideReason) {
      await client.query(
        `SELECT set_config('app.override_reason', $1, true)`,
        [overrideReason]
      );
    }

    for (const entry of entries) {
      const key = cellKey(entry.membershipId, entry.parameterId);
      const row = existing.get(key);
      const to = effectiveEntry(entry, row, source === 'import');
      const before = row
        ? {
            selected: !row.archivedAt,
            qualityValue: row.qualityValue,
            quantityValue: row.quantityValue,
            qualityComment: row.qualityComment,
            quantityComment: row.quantityComment,
          }
        : null;

      const result = await writeEvaluationCell(client, sessionId, to, row);

      if (result.rowCount > 0) {
        const target = entry.membershipId
          ? targets.get(entry.membershipId)
          : null;
        const parameter = parameters.get(entry.parameterId);
        changes.push({
          membershipId: entry.membershipId,
          student: target ? target.fullName : null,
          studentCode: target ? target.studentCode : null,
          parameterId: entry.parameterId,
          parameter: parameter.name,
          from: before,
          to,
          override: overriddenKeys.has(key),
        });
        snapshots.old.push(
          before ? { key, ...before } : { key, existed: false }
        );
        snapshots.new.push(
          entry.selected ? { key, ...to } : { key, archived: true }
        );
      }
    }

    if (changes.length > 0) {
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'scores.save',
        entityType: 'session',
        entityId: sessionId,
        details: {
          sessionId,
          sessionCode: session.sessionCode,
          assignmentCode: session.assignmentCode,
          count: changes.length,
          changes,
          ...(source === 'import' ? { source: 'import' } : {}),
          ...(overrideReason ? { overrideReason } : {}),
        },
        oldData: { cells: snapshots.old },
        newData: { cells: snapshots.new },
      });
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    // The range trigger speaks in check_violation; translate the common case.
    if (err.code === '23514' && /outside parameter .* range/.test(String(err.message))) {
      return res.status(400).json({
        error: 'A value is outside the parameter range. Nothing was saved.',
        code: 'EVALUATIONS_INVALID_ENTRIES',
      });
    }
    throw err;
  } finally {
    client.release();
  }

  res.json({ sessionId, changed: changes.length });
});

router.put('/evaluations/:id/archive', async (req, res) => {
  if (!isUuid(req.params.id) || typeof req.body?.archived !== 'boolean') {
    return res.status(400).json({ error: 'Choose a cell and archived state.', code: 'VALIDATION_INVALID_TYPE' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const result = await client.query('SELECT id,locks_at<=now() AS locked FROM evaluations WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Evaluation not found.', code: 'NOT_FOUND' });
    }
    if (result.rows[0].locked) {
      if (!userCan(req, 'scores.override')) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'This score is locked.', code: 'LOCKED' });
      }
      const reason = parseOverrideReason(req.body.overrideReason);
      if (reason.error) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: reason.error, code: 'OVERRIDE_REASON_REQUIRED' });
      }
      await client.query("SELECT set_config('app.override_reason',$1,true)", [reason.value]);
    }
    await client.query('UPDATE evaluations SET archived_at=CASE WHEN $2 THEN COALESCE(archived_at,now()) ELSE NULL END WHERE id=$1', [req.params.id, req.body.archived]);
    await client.query('COMMIT');
    res.json({ id: req.params.id, archived: req.body.archived });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally { client.release(); }
});

export default router;
