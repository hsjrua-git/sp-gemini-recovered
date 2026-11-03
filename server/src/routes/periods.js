import { Router } from 'express';
import pool from '../db/pool.js';
import { isUuid } from '../lib/ids.js';
import { userCan } from '../middleware/auth.js';
import {
  listAssignmentPeriods,
} from '../lib/periods.js';

const router = Router();

// Persisted answered-session periods for one assignment. Generated or merely
// selected sessions stay outside a period until their first answer. The
// answered-cell count is stripped for callers without scores.view.
router.get('/periods', async (req, res) => {
  const { assignmentId } = req.query;
  if (assignmentId !== undefined && !isUuid(assignmentId)) {
    return res.status(400).json({
      error: 'assignmentId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'assignmentId' },
    });
  }

  const assignment = assignmentId === undefined ? { rowCount: 1 } : await pool.query(
    'SELECT id FROM assignments WHERE id = $1',
    [assignmentId]
  );
  if (assignment.rowCount === 0) {
    return res.status(404).json({
      error: 'Assignment not found.',
      code: 'NOT_FOUND',
      params: { entity: 'assignment' },
    });
  }

  let periods = await listAssignmentPeriods(pool, assignmentId);
  if (req.query.includeArchived === '1') {
    const archived = await pool.query(
      `SELECT p.id,p.assignment_id AS "assignmentId",p.seq,p.archived_at AS "archivedAt",
              a.code AS "assignmentCode"
       FROM periods p JOIN assignments a ON a.id=p.assignment_id
       WHERE p.archived_at IS NOT NULL AND ($1::uuid IS NULL OR p.assignment_id=$1)
       ORDER BY p.assignment_id,p.seq`, [assignmentId ?? null],
    );
    periods = [...periods, ...archived.rows];
  }
  res.json({
    periods: userCan(req, 'scores.view')
      ? periods
      : periods.map(({ answeredCount, ...rest }) => rest),
  });
});

router.put('/periods/:id', async (req, res) => {
  if (!isUuid(req.params.id) || typeof req.body?.archived !== 'boolean') {
    return res.status(400).json({ error: 'Choose a period and archived state.', code: 'VALIDATION_INVALID_TYPE' });
  }
  const result = await pool.query(
    `UPDATE periods SET archived_at=CASE WHEN $2 THEN COALESCE(archived_at,now()) ELSE NULL END
     WHERE id=$1 RETURNING id,archived_at AS "archivedAt"`, [req.params.id, req.body.archived],
  );
  if (!result.rowCount) return res.status(404).json({ error: 'Period not found.', code: 'NOT_FOUND' });
  res.json({ period: result.rows[0] });
});

export default router;
