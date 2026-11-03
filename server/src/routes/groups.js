import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { descendantGroupIds } from '../lib/groups.js';
import { isUuid } from '../lib/ids.js';
import { generateCode } from '../lib/studentCode.js';
import { isValidIsoDate, todayIso } from '../lib/periods.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';
const CHECK_VIOLATION = '23514';

function handleGroupWriteError(err, res) {
  if (err.code === UNIQUE_VIOLATION) {
    res.status(409).json({
      error: 'A group with that name or code already exists here.',
      code: 'VALIDATION_NOT_UNIQUE',
    });
    return true;
  }
  if (err.code !== CHECK_VIOLATION) return false;
  if (/active children/.test(String(err.message))) {
    res.status(409).json({
      error: 'Archive or move its subgroups first.',
      code: 'GROUPS_NOT_EMPTY',
    });
  } else if (/archived group/.test(String(err.message))) {
    res.status(409).json({
      error: 'An active group cannot be placed under an archived group.',
      code: 'GROUPS_PARENT_ARCHIVED',
    });
  } else {
    res.status(409).json({
      error: 'A group cannot be moved inside itself or one of its subgroups.',
      code: 'GROUPS_CYCLE',
    });
  }
  return true;
}

// A group code may be given; otherwise one is generated. 1..40 chars, as the
// schema's group_code_ck enforces.
function parseCode(input) {
  if (input === undefined || input === null || String(input).trim() === '') {
    return { value: null }; // auto-generate
  }
  const code = String(input).trim();
  if (code.length < 1 || code.length > 40) {
    return {
      error: 'Group code must be 1 to 40 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 40 },
    };
  }
  return { value: code };
}

function parseSortOrder(input) {
  if (!Number.isInteger(input) || input < 0) {
    return {
      error: 'Sort order must be a whole number from 0.',
      code: 'VALIDATION_INVALID_TYPE',
      params: { field: 'sortOrder' },
    };
  }
  return { value: input };
}

function parseName(input) {
  if (typeof input !== 'string') {
    return { error: 'Group name is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return {
      error: 'Group name must be 1 to 60 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 60 },
    };
  }
  return { value };
}

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res
      .status(404)
      .json({ error: 'Group not found.', code: 'NOT_FOUND', params: { entity: 'group' } });
  }
  next();
});

router.get('/', async (req, res) => {
  const { studentId } = req.query;
  const includeArchived = req.query.includeArchived === '1';

  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      return res.status(400).json({
        error: 'studentId must be a valid ID.',
        code: 'VALIDATION_INVALID_FORMAT',
        params: { field: 'studentId' },
      });
    }
    const result = await pool.query(
      `SELECT g.id, g.name, g.parent_id AS "parentId"
       FROM student_groups g
       JOIN student_group_members m ON m.group_id = g.id
       WHERE m.student_id = $1 AND m.left_on IS NULL AND g.archived_at IS NULL
       ORDER BY lower(g.name)`,
      [studentId]
    );
    return res.json({ groups: result.rows });
  }

  const result = await pool.query(
    `SELECT g.id,
            g.code,
            g.name,
            g.sort_order AS "sortOrder",
            g.parent_id  AS "parentId",
            g.archived_at AS "archivedAt",
            (SELECT count(*)::int FROM student_group_members m
             WHERE m.group_id = g.id AND m.left_on IS NULL) AS "memberCount"
     FROM student_groups g
     WHERE $1 OR g.archived_at IS NULL
     ORDER BY g.sort_order, lower(g.name)`,
    [includeArchived]
  );
  res.json({ groups: result.rows });
});

async function loadGroup(db, id) {
  const result = await db.query(
    `SELECT id, code, name, sort_order AS "sortOrder",
            parent_id AS "parentId", archived_at AS "archivedAt"
     FROM student_groups WHERE id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

async function liveChildCount(db, id) {
  const result = await db.query(
    `SELECT count(*)::int AS count FROM student_groups
     WHERE parent_id = $1 AND archived_at IS NULL`,
    [id]
  );
  return result.rows[0].count;
}

router.post('/', async (req, res) => {
  const name = parseName(req.body?.name);
  if (name.error) {
    return res
      .status(400)
      .json({ error: name.error, code: name.code, params: name.params });
  }

  const code = parseCode(req.body?.code);
  if (code.error) {
    return res
      .status(400)
      .json({ error: code.error, code: code.code, params: code.params });
  }
  const sortOrder = parseSortOrder(req.body?.sortOrder ?? 0);
  if (sortOrder.error) {
    return res.status(400).json({
      error: sortOrder.error,
      code: sortOrder.code,
      params: sortOrder.params,
    });
  }

  const parentId = req.body?.parentId ?? null;
  if (parentId !== null && !isUuid(parentId)) {
    return res.status(400).json({
      error: 'Choose a valid parent group.',
      code: 'VALIDATION_INVALID_CHOICE',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    if (parentId !== null) {
      const parent = await loadGroup(client, parentId);
      if (!parent || parent.archivedAt) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'That parent group does not exist.',
          code: 'NOT_FOUND',
          params: { entity: 'group' },
        });
      }
    }
    const inserted = await client.query(
      `INSERT INTO student_groups (name, code, sort_order, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, sort_order AS "sortOrder",
                 parent_id AS "parentId", archived_at AS "archivedAt"`,
      [name.value, code.value ?? generateCode(), sortOrder.value, parentId, req.user.id]
    );
    const group = inserted.rows[0];
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'group.create',
      entityType: 'group',
      entityId: group.id,
      details: { name: group.name, parentId },
    });
    await client.query('COMMIT');
    res.status(201).json({ group: { ...group, memberCount: 0 } });
  } catch (err) {
    await client.query('ROLLBACK');
    if (handleGroupWriteError(err, res)) return;
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const body = req.body ?? {};
  const updates = {};

  if ('name' in body) {
    const name = parseName(body.name);
    if (name.error) {
      return res
        .status(400)
        .json({ error: name.error, code: name.code, params: name.params });
    }
    updates.name = name.value;
  }
  if ('parentId' in body) {
    if (body.parentId !== null && !isUuid(body.parentId)) {
      return res.status(400).json({
        error: 'Choose a valid parent group.',
        code: 'VALIDATION_INVALID_CHOICE',
      });
    }
    updates.parentId = body.parentId;
  }
  if ('code' in body) {
    const code = parseCode(body.code);
    if (code.error) {
      return res
        .status(400)
        .json({ error: code.error, code: code.code, params: code.params });
    }
    if (code.value === null) {
      return res.status(400).json({
        error: 'A group code cannot be cleared.',
        code: 'VALIDATION_REQUIRED',
        params: { field: 'code' },
      });
    }
    updates.code = code.value;
  }
  if ('sortOrder' in body) {
    const sortOrder = parseSortOrder(body.sortOrder);
    if (sortOrder.error) {
      return res.status(400).json({
        error: sortOrder.error,
        code: sortOrder.code,
        params: sortOrder.params,
      });
    }
    updates.sortOrder = sortOrder.value;
  }
  if ('archived' in body) {
    if (typeof body.archived !== 'boolean') {
      return res.status(400).json({
        error: 'archived must be true or false.',
        code: 'VALIDATION_INVALID_TYPE',
      });
    }
    updates.archived = body.archived;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, req.params.id);
    if (!group) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Group not found.', code: 'NOT_FOUND', params: { entity: 'group' } });
    }

    if ('parentId' in updates && updates.parentId !== group.parentId) {
      if (updates.parentId !== null) {
        const parent = await loadGroup(client, updates.parentId);
        if (!parent || parent.archivedAt) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'That parent group does not exist.',
            code: 'NOT_FOUND',
            params: { entity: 'group' },
          });
        }
        // A group cannot move under itself or any of its own descendants.
        const descendants = await descendantGroupIds(client, group.id);
        if (descendants.includes(updates.parentId)) {
          await client.query('ROLLBACK');
          return res.status(409).json({
            error: 'A group cannot be moved inside itself or one of its subgroups.',
            code: 'GROUPS_CYCLE',
          });
        }
      }
    }

    if (updates.archived === true && !group.archivedAt) {
      if ((await liveChildCount(client, group.id)) > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Archive or move its subgroups first.',
          code: 'GROUPS_NOT_EMPTY',
        });
      }
    }

    const sets = [];
    const values = [];
    if ('name' in updates) {
      values.push(updates.name);
      sets.push(`name = $${values.length}`);
    }
    if ('code' in updates) {
      values.push(updates.code);
      sets.push(`code = $${values.length}`);
    }
    if ('sortOrder' in updates) {
      values.push(updates.sortOrder);
      sets.push(`sort_order = $${values.length}`);
    }
    if ('parentId' in updates) {
      values.push(updates.parentId);
      sets.push(`parent_id = $${values.length}`);
    }
    if ('archived' in updates) {
      sets.push(`archived_at = ${updates.archived ? 'now()' : 'NULL'}`);
    }
    values.push(group.id);
    const updated = await client.query(
      `UPDATE student_groups SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING id, code, name, sort_order AS "sortOrder",
                 parent_id AS "parentId", archived_at AS "archivedAt"`,
      values
    );

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'group.update',
      entityType: 'group',
      entityId: group.id,
      details: { name: updated.rows[0].name, changes: updates },
    });
    await client.query('COMMIT');
    res.json({ group: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (handleGroupWriteError(err, res)) return;
    throw err;
  } finally {
    client.release();
  }
});

// DELETE archives the group (we never hard-delete, to keep history intact).
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, req.params.id);
    if (!group) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Group not found.', code: 'NOT_FOUND', params: { entity: 'group' } });
    }
    if (group.archivedAt) {
      await client.query('ROLLBACK');
      return res.status(204).end();
    }
    if ((await liveChildCount(client, group.id)) > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Archive or move its subgroups first.',
        code: 'GROUPS_NOT_EMPTY',
      });
    }
    await client.query(
      `UPDATE student_groups SET archived_at = now() WHERE id = $1`,
      [group.id]
    );
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'group.archive',
      entityType: 'group',
      entityId: group.id,
      details: { name: group.name },
    });
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    if (handleGroupWriteError(err, res)) return;
    throw err;
  } finally {
    client.release();
  }
});

router.get('/:id/members', async (req, res) => {
  const group = await loadGroup(pool, req.params.id);
  if (!group) {
    return res
      .status(404)
      .json({ error: 'Group not found.', code: 'NOT_FOUND', params: { entity: 'group' } });
  }
  const result = await pool.query(
    `SELECT s.id,
            s.full_name    AS "fullName",
            s.student_code AS "studentCode",
            m.id           AS "membershipId",
            m.joined_on::text  AS "joinedOn",
            m.left_on::text    AS "leftOn",
            m.created_at      AS "createdAt"
     FROM student_group_members m
     JOIN students s ON s.id = m.student_id AND s.deleted_at IS NULL
     WHERE m.group_id = $1
     ORDER BY m.left_on IS NOT NULL, lower(s.full_name)`,
    [req.params.id]
  );
  res.json({ students: result.rows });
});

// PUT is mapped to the groups.assign permission in index.js.
router.put('/:id/members', async (req, res) => {
  const joinedOn = req.body?.joinedOn ?? todayIso();
  const leftOn = req.body?.leftOn ?? todayIso();
  if (!isValidIsoDate(joinedOn) || !isValidIsoDate(leftOn)) {
    return res.status(400).json({ error: 'Use valid membership dates.', code: 'VALIDATION_INVALID_DATE' });
  }
  const add = Array.isArray(req.body?.add) ? req.body.add : [];
  const remove = Array.isArray(req.body?.remove) ? req.body.remove : [];
  if (![...add, ...remove].every((id) => isUuid(id))) {
    return res.status(400).json({
      error: 'Student ids must be valid IDs.',
      code: 'VALIDATION_INVALID_FORMAT',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, req.params.id);
    if (!group) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Group not found.', code: 'NOT_FOUND', params: { entity: 'group' } });
    }
    if (group.archivedAt) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'This group is archived.',
        code: 'GROUPS_ARCHIVED',
      });
    }

    let added = 0;
    let removed = 0;
    if (add.length > 0) {
      const result = await client.query(
        `INSERT INTO student_group_members (student_id, group_id, joined_on)
         SELECT s.id, $1, $3::date
         FROM students s
         WHERE s.id = ANY($2::uuid[]) AND s.deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [group.id, add, joinedOn]
      );
      added = result.rowCount;
    }
    if (remove.length > 0) {
      // Leaving is recorded, not deleted: the row keeps the membership's
      // history and only stops counting once left_on is set.
      const result = await client.query(
        `UPDATE student_group_members
         SET left_on = $3::date
         WHERE group_id = $1 AND student_id = ANY($2::uuid[])
           AND left_on IS NULL`,
        [group.id, remove, leftOn]
      );
      removed = result.rowCount;
    }

    if (added > 0 || removed > 0) {
      await recordAudit(client, {
        userId: req.user.id,
        actor: req.user.username,
        action: 'group.members',
        entityType: 'group',
        entityId: group.id,
        details: { name: group.name, added, removed },
      });
    }
    await client.query('COMMIT');
    res.json({ added, removed });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

// PUT retains the groups.assign policy; changing dates is membership work.
router.put('/:id/members/:membershipId', async (req, res) => {
  const { joinedOn, leftOn = null } = req.body ?? {};
  if (!isUuid(req.params.membershipId) || !isValidIsoDate(joinedOn) ||
      (leftOn !== null && (!isValidIsoDate(leftOn) || leftOn < joinedOn))) {
    return res.status(400).json({ error: 'Use valid membership dates in order.', code: 'VALIDATION_INVALID_DATE' });
  }
  try {
    const result = await pool.query(
      `UPDATE student_group_members SET joined_on=$3,left_on=$4
       WHERE group_id=$1 AND id=$2
       RETURNING id, joined_on::text AS "joinedOn",left_on::text AS "leftOn",created_at AS "createdAt"`,
      [req.params.id, req.params.membershipId, joinedOn, leftOn],
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Membership not found.', code: 'NOT_FOUND' });
    res.json({ membership: result.rows[0] });
  } catch (err) {
    if (['23514','23505'].includes(err.code)) {
      return res.status(409).json({ error: 'These dates conflict with retained history or another membership.', code: 'MEMBERSHIP_HISTORY_CONFLICT' });
    }
    throw err;
  }
});

export default router;
