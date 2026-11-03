// Evaluations (session cells) — service layer (framework-free).
//
// PGlite test mirror of routes/evaluations.js under the schema-4 model: an
// evaluation ROW is one session cell — a session × parameter × target (a
// member, or the whole group via membership NULL) — carrying two
// independently-nullable ranged integers (quality, quantity), each with its
// own comment. The read query filters by sessionId/assignmentId/studentId/
// parameterId (at least one required); the bulk save treats `selected` as the
// cell's existence (a stored row IS the expectation; selected:false deletes)
// with the dry-run preview, lock/override handling, and audit trail. Plain
// args in, plain data out, ServiceError instead of status codes, getDb() for
// the pool, getLocalActor() for the audit row.
//
// Single-user collapse of the two permission checks the route made:
//   * userCan(req, 'scores.view')     -> always true: the dry-run preview is
//     never redacted (the mirror uses one all-powerful test admin).
//   * userCan(req, 'scores.override') -> always true: the admin may always
//     edit a locked cell. The lock itself is KEPT as a deliberate guardrail —
//     a locked change still needs a written override reason, which is audited.
//
// Rich failures (invalid entries, a missing override reason) carry their
// structured payload on ServiceError.details ({ problems, code }) so the client
// adapter can render the same UI the route's JSON body drove.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor } from '../context.js';
import { recordAudit } from '../../lib/audit.js';
import { isUuid } from '../../lib/ids.js';
import {
  cellKey,
  findLockedChanges,
  parseOverrideReason,
} from '../../lib/locks.js';
import { effectiveEntry, writeEvaluationCell } from '../../lib/evaluationCell.js';
import {
  findProblems,
  normalizeComment,
  validateShape,
} from '../../lib/evaluationCheck.js';
import { previewCells, previewCounts } from '../../lib/scorePreview.js';

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
`;

// The assignment's valid evaluation targets: for a group assignment every
// open membership of the group, for an individual assignment exactly its own
// member. Maps membershipId → student info.
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

// Read stored cells. `filters` = { sessionId?, assignmentId?, studentId?,
// parameterId? } — at least one is required so this can never become a
// full-table dump.
export async function getEvaluations(filters = {}) {
  const db = getDb();
  const { sessionId, assignmentId, parameterId, studentId } = filters;
  const conditions = ['e.archived_at IS NULL'];
  const values = [];

  if (sessionId !== undefined) {
    if (!isUuid(sessionId)) {
      throw ServiceError.validation('sessionId must be a valid ID.');
    }
    values.push(sessionId);
    conditions.push(`e.session_id = $${values.length}`);
  }
  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      throw ServiceError.validation('assignmentId must be a valid ID.');
    }
    values.push(assignmentId);
    conditions.push(`s.assignment_id = $${values.length}`);
  }
  if (parameterId !== undefined) {
    if (!isUuid(parameterId)) {
      throw ServiceError.validation('parameterId must be a valid ID.');
    }
    values.push(parameterId);
    conditions.push(`e.parameter_id = $${values.length}`);
  }
  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      throw ServiceError.validation('studentId must be a valid ID.');
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
    throw ServiceError.validation(
      'Add at least one filter: sessionId, assignmentId, studentId or parameterId.',
      { code: 'EVALUATIONS_FILTER_REQUIRED' }
    );
  }

  const result = await db.query(
    `${EVALUATION_SELECT}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.seq, e.parameter_id, e.membership_id NULLS FIRST
     LIMIT 20000`,
    values
  );
  return { evaluations: result.rows };
}

// Bulk-save one session's cells. `input` = { sessionId, entries,
// overrideReason?, dryRun?, source? }. Each entry: { membershipId (null =
// whole group), parameterId, selected, qualityValue, quantityValue,
// qualityComment?, quantityComment? } — the full cell state.
export async function saveEvaluationsBulk(input = {}) {
  const db = getDb();
  const {
    sessionId,
    entries,
    overrideReason: reasonInput,
    dryRun = false,
    source,
  } = input;

  if (typeof dryRun !== 'boolean') {
    throw ServiceError.validation('dryRun must be true or false.');
  }
  if (source !== undefined && source !== 'import') {
    throw ServiceError.validation('Unknown source.');
  }
  if (!isUuid(sessionId)) {
    throw ServiceError.validation('sessionId must be a valid ID.');
  }
  const shapeError = validateShape(entries, { patch: source === 'import' });
  if (shapeError) {
    throw ServiceError.validation(shapeError, { code: 'EVALUATIONS_INVALID_SHAPE' });
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

  const sessionResult = await db.query(
    `SELECT s.id              AS "sessionId",
            s.code            AS "sessionCode",
            s.session_date::text AS "sessionDate",
            s.canceled_at     AS "canceledAt",
            s.archived_at     AS "archivedAt",
            a.group_id        AS "groupId",
             a.membership_id   AS "assignmentMembershipId",
             a.code            AS "assignmentCode",
             a.name            AS "assignmentName",
             a.archived_at     AS "assignmentArchivedAt",
             g.archived_at     AS "groupArchivedAt"
     FROM sessions s
     JOIN assignments a ON a.id = s.assignment_id
     LEFT JOIN student_groups g ON g.id = a.group_id
     WHERE s.id = $1`,
    [sessionId]
  );
  const session = sessionResult.rows[0];
  if (!session) {
    throw ServiceError.notFound('Session not found.');
  }
  if (
    session.canceledAt ||
    session.archivedAt ||
    session.assignmentArchivedAt ||
    session.groupArchivedAt
  ) {
    throw ServiceError.conflict(
      'This session is canceled or archived; its cells cannot change.',
      { code: 'SESSIONS_NOT_ACTIVE' }
    );
  }

  const [targets, parametersResult] = await Promise.all([
    loadTargets(db, session),
    db.query(
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
  if (
    session.assignmentMembershipId &&
    entries.some((entry) => entry.membershipId === null)
  ) {
    throw ServiceError.validation(
      'This assignment targets a single student; whole-group rows are not allowed.',
      { code: 'EVALUATIONS_TARGET_MISMATCH' }
    );
  }

  const problems = findProblems({ entries, parameters, memberships: targets });

  if (dryRun) {
    const existingResult = await db.query(
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
    const cells = previewCells({
      entries,
      existing,
      problemIndexes: new Set(problems.map((problem) => problem.index)),
      canViewScores: true,
      patch: source === 'import',
    });
    return {
      dryRun: true,
      sessionId,
      cells,
      problems,
      counts: previewCounts(cells, problems),
    };
  }

  if (problems.length > 0) {
    throw ServiceError.validation('Some entries are invalid. Nothing was saved.', {
      code: 'EVALUATIONS_INVALID_ENTRIES',
      problems,
    });
  }

  return saveBulk({
    db,
    session,
    entries,
    targets,
    parameters,
    reasonInput,
    source,
  });
}

// The transactional write, reached only after validation passed and dryRun is
// false. Locks the session's rows FOR UPDATE, resolves the override reason for
// any locked change (the single admin may always override, but a locked change
// still demands a written reason — audited), then applies each entry as a
// archive (unselect) or an upsert and records one audit row for the batch with
// old_data/new_data cell snapshots.
async function saveBulk({
  db,
  session,
  entries,
  targets,
  parameters,
  reasonInput,
  source,
}) {
  const { sessionId } = session;
  const changes = [];
  const snapshots = { old: [], new: [] };
  let overrideReason = null;

  const client = await db.connect();
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

    const lockedChanges = findLockedChanges({ entries, existing, patch: source === 'import' });
    const overriddenKeys = new Set(
      lockedChanges.map((item) => cellKey(item.membershipId, item.parameterId))
    );

    // Single admin: the "no override permission" 409 path is gone. The lock is
    // still a guardrail — a locked change needs a written reason, which we audit.
    if (lockedChanges.length > 0) {
      const reason = parseOverrideReason(reasonInput);
      if (reason.error) {
        await client.query('ROLLBACK').catch(() => {});
        throw ServiceError.validation(reason.error, {
          code: 'OVERRIDE_REASON_REQUIRED',
          problems: lockedChanges.map((item) => ({
            index: item.index,
            membershipId: item.membershipId,
            parameterId: item.parameterId,
            message: 'Locked. Changing it needs a written reason.',
          })),
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
        const target = entry.membershipId ? targets.get(entry.membershipId) : null;
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
      const actor = getLocalActor();
      await recordAudit(client, {
        userId: actor.userId,
        actor: actor.actor,
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
    await client.query('ROLLBACK').catch(() => {});
    // The range trigger speaks in check_violation; translate the common case.
    if (err.code === '23514' && /outside parameter .* range/.test(String(err.message))) {
      throw ServiceError.validation(
        'A value is outside the parameter range. Nothing was saved.',
        { code: 'EVALUATIONS_INVALID_ENTRIES' }
      );
    }
    throw err;
  } finally {
    client.release();
  }

  return { sessionId, changed: changes.length };
}
