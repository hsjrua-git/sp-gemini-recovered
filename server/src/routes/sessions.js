import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import { isValidIsoDate, todayIso } from '../lib/periods.js';
import { parseSessionPlan, planSessions, applySessionPlan } from '../lib/sessionPlan.js';

const router = Router();
const MAX_LISTED = 500;

const SESSION_COLUMNS = `
  s.id,
  s.assignment_id  AS "assignmentId",
  s.seq,
  s.code,
  s.planned_date::text AS "plannedDate",
  s.moved_to::text     AS "movedTo",
  s.session_date::text AS "sessionDate",
  s.canceled_at    AS "canceledAt",
  s.note,
  s.archived_at    AS "archivedAt",
  s.period_id      AS "periodId",
  p.seq            AS "periodSeq",
  (SELECT count(*)::int FROM tasks tk WHERE tk.session_id = s.id)
                  AS "taskCount",
  a.code           AS "assignmentCode",
  a.name           AS "assignmentName",
  t.full_name      AS "teacherName",
  a.group_id       AS "groupId",
  g.name           AS "groupName",
  a.membership_id  AS "membershipId",
  sf.full_name     AS "studentName"
`;

const SESSION_FROM = `
  FROM sessions s
  JOIN assignments a ON a.id = s.assignment_id
  JOIN teachers t ON t.id = a.teacher_id
  LEFT JOIN student_groups g ON g.id = a.group_id
  LEFT JOIN student_group_members ms ON ms.id = a.membership_id
  LEFT JOIN students sf ON sf.id = ms.student_id
  LEFT JOIN periods p ON p.id = s.period_id AND p.archived_at IS NULL
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Session not found.',
      code: 'NOT_FOUND',
      params: { entity: 'session' },
    });
  }
  next();
});

router.get('/', async (req, res) => {
  const { assignmentId, teacherId, from, to } = req.query;
  const includeCanceled = req.query.includeCanceled === '1';
  const includeArchived = req.query.includeArchived === '1';

  const conditions = [includeArchived ? 'TRUE' : 's.archived_at IS NULL'];
  const values = [];
  const push = (value) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (assignmentId !== undefined) {
    if (!isUuid(assignmentId)) {
      return res.status(400).json({
        error: 'assignmentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'assignmentId' },
      });
    }
    conditions.push(`s.assignment_id = ${push(assignmentId)}`);
  }
  if (teacherId !== undefined) {
    if (!isUuid(teacherId)) {
      return res.status(400).json({
        error: 'teacherId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'teacherId' },
      });
    }
    conditions.push(`a.teacher_id = ${push(teacherId)}`);
  }
  if (from !== undefined) {
    if (!isValidIsoDate(from)) {
      return res.status(400).json({
        error: 'from must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'from' },
      });
    }
    conditions.push(`s.session_date >= ${push(from)}::date`);
  }
  if (to !== undefined) {
    if (!isValidIsoDate(to)) {
      return res.status(400).json({
        error: 'to must be a date (YYYY-MM-DD).',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'to' },
      });
    }
    conditions.push(`s.session_date <= ${push(to)}::date`);
  }
  if (!includeCanceled) {
    conditions.push('s.canceled_at IS NULL');
  }

  const result = await pool.query(
    `SELECT ${SESSION_COLUMNS}
     ${SESSION_FROM}
     WHERE ${conditions.join(' AND ')}
     ORDER BY s.session_date, s.code
     LIMIT ${MAX_LISTED + 1}`,
    values
  );

  res.json({
    sessions: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

// Generate the missing planned sessions for active assignments, up to a
// horizon date. Idempotent: existing planned dates are skipped.
router.post('/generate', async (req, res) => {
  const parsed = parseSessionPlan(req.body);
  if (parsed.error) return res.status(400).json(parsed);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const plan = await planSessions(client, parsed.value);
    if (plan.error) { await client.query('ROLLBACK'); return res.status(400).json(plan); }
    if (req.body.dryRun === true) { await client.query('ROLLBACK'); return res.json(plan); }
    if (req.body.previewToken !== plan.token) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Preview this plan again before confirming.', code: 'SESSION_PLAN_STALE' });
    }
    const created = await applySessionPlan(client, plan.rows);
    if (created > 0) {
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'session.generate',
        entityType: 'session',
        details: { ...parsed.value, created },
      });
    }
    await client.query('COMMIT');
    res.status(201).json({ created });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Only the operational fields change: moving a session, canceling it, or
// annotating it. The planned date, sequence and code are immutable.
router.patch('/:id', async (req, res) => {
  const body =
    req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
  const sets = [];
  const values = [];

  if ('movedTo' in body) {
    const movedTo = body.movedTo;
    if (movedTo !== null && !isValidIsoDate(movedTo)) {
      return res.status(400).json({
        error: 'movedTo must be a date (YYYY-MM-DD) or null.',
        code: 'VALIDATION_INVALID_DATE',
        params: { field: 'movedTo' },
      });
    }
    values.push(movedTo);
    sets.push(`moved_to = $${values.length}::date`);
  }
  if ('canceled' in body) {
    if (typeof body.canceled !== 'boolean') {
      return res.status(400).json({
        error: 'canceled must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`canceled_at = ${body.canceled ? 'now()' : 'NULL'}`);
  }
  if ('note' in body) {
    const note = body.note;
    if (note !== null && typeof note !== 'string') {
      return res.status(400).json({
        error: 'note must be text.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    const trimmed = note?.trim() ?? '';
    if (trimmed.length > 500) {
      return res.status(400).json({
        error: 'note must be 500 characters or fewer.',
        code: 'VALIDATION_TOO_LONG',
        params: { max: 500 },
      });
    }
    values.push(trimmed === '' ? null : trimmed);
    sets.push(`note = $${values.length}`);
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return res.status(400).json({
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    sets.push(`archived_at = ${body.archived ? 'now()' : 'NULL'}`);
  }
  if (sets.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  values.push(req.params.id);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const result = await client.query(
      `UPDATE sessions
       SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, assignment_id,
                  session_date::text AS "sessionDate",
                  canceled_at AS "canceledAt",
                  archived_at AS "archivedAt"`,
      values
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Session not found.',
        code: 'NOT_FOUND',
        params: { entity: 'session' },
      });
    }
    // The database reanchors still-open deadlines using first_answered_at.
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23514' && /active evaluation cells/.test(String(err.message))) {
      return res.status(409).json({
        error: 'Archive or remove the active evaluation cells before canceling this session.',
        code: 'SESSIONS_HAS_EVALUATIONS',
      });
    }
    throw err;
  } finally {
    client.release();
  }

  const full = await pool.query(
    `SELECT ${SESSION_COLUMNS} ${SESSION_FROM} WHERE s.id = $1`,
    [req.params.id]
  );
  res.json({ session: full.rows[0] });
});

export default router;
