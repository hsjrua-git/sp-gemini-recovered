import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { isUuid } from '../lib/ids.js';
import { scanAlerts } from '../lib/alerts.js';
import { parseAlertPatch, parseAlertStatus } from '../validation/alerts.js';

const router = Router();
const MAX_LISTED = 200;
const UNIQUE_VIOLATION = '23505';

const ALERT_COLUMNS = `
  a.id,
  a.kind,
  a.session_id   AS "sessionId",
  a.message,
  a.resolved_at  AS "resolvedAt",
  a.created_at   AS "createdAt",
  s.code              AS "sessionCode",
  s.session_date::text AS "sessionDate",
  s.canceled_at       AS "sessionCanceledAt",
  asg.code       AS "assignmentCode",
  asg.name       AS "assignmentName",
  t.full_name    AS "teacherName",
  g.name         AS "groupName",
  sf.full_name   AS "studentName"
`;

const ALERT_FROM = `
  FROM alerts a
  LEFT JOIN sessions s ON s.id = a.session_id
  LEFT JOIN assignments asg ON asg.id = s.assignment_id
  LEFT JOIN teachers t ON t.id = asg.teacher_id
  LEFT JOIN student_groups g ON g.id = asg.group_id
  LEFT JOIN student_group_members ms ON ms.id = asg.membership_id
  LEFT JOIN students sf ON sf.id = ms.student_id
`;

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res.status(404).json({
      error: 'Alert not found.',
      code: 'NOT_FOUND',
      params: { entity: 'alert' },
    });
  }
  next();
});

// Open alerts first (they are the actionable ones), newest first within each
// group. The list is read-only; raising and closing alerts happens in /scan.
router.get('/', async (req, res) => {
  const status = parseAlertStatus(req.query.status);
  if (status.error) {
    return res
      .status(400)
      .json({ error: status.error, code: status.code, params: status.params });
  }

  let where = '';
  if (status.value === 'open') where = 'WHERE a.resolved_at IS NULL';
  if (status.value === 'resolved') where = 'WHERE a.resolved_at IS NOT NULL';

  const result = await pool.query(
    `SELECT ${ALERT_COLUMNS}
     ${ALERT_FROM}
     ${where}
     ORDER BY a.resolved_at IS NOT NULL, a.created_at DESC
     LIMIT ${MAX_LISTED + 1}`
  );
  res.json({
    alerts: result.rows.slice(0, MAX_LISTED),
    truncated: result.rows.length > MAX_LISTED,
  });
});

// Raise alerts for overdue sessions whose selected cells are not all answered,
// and close alerts once the session is complete or inactive.
// Idempotent: nothing to do is a plain { raised: 0, resolved: 0 }.
router.post('/scan', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { raised, resolved } = await scanAlerts(client);
    if (raised > 0 || resolved > 0) {
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'alert.scan',
        entityType: 'alert',
        details: { raised, resolved },
      });
    }
    await client.query('COMMIT');
    res.status(201).json({ raised, resolved });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// Resolving acknowledges the current alert. If the session remains incomplete,
// a later scan may raise a new alert while retaining the resolved history.
router.patch('/:id', async (req, res) => {
  const parsed = parseAlertPatch(req.body);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  try {
    const result = await pool.query(
      `UPDATE alerts
       SET resolved_at = ${parsed.value.resolved ? 'now()' : 'NULL'}
       WHERE id = $1
       RETURNING id`,
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({
        error: 'Alert not found.',
        code: 'NOT_FOUND',
        params: { entity: 'alert' },
      });
    }
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'An open alert already exists for this session and kind.',
        code: 'CONFLICT',
      });
    }
    throw err;
  }
  const full = await pool.query(
    `SELECT ${ALERT_COLUMNS} ${ALERT_FROM} WHERE a.id = $1`,
    [req.params.id]
  );
  res.json({ alert: full.rows[0] });
});

router.delete('/:id', async (req, res) => {
  const result = await pool.query('DELETE FROM alerts WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Alert not found.', code: 'NOT_FOUND' });
  res.status(204).end();
});

export default router;
