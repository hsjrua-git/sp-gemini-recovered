// Student groups — service layer (framework-free).
//
// PGlite test mirror of routes/groups.js. Same peeling as the other services:
// plain args in, plain data out, ServiceError instead of status codes, getDb()
// for the pool, getLocalActor() for the audit trail, no permission gating (the
// route split groups.manage vs groups.assign; the single admin has both). The
// route's router.param('id') uuid guard becomes an isUuid check returning
// NOT_FOUND at the top of each id-taking function, matching the 404 it produced.
//
// Groups now carry a NOT NULL unique code (auto-generated when omitted) and a
// sort order; both are accepted on create and update exactly as the route does.
// The route's local parseName/parseCode/parseSortOrder are pure and move here
// verbatim. The nested-move cycle check reuses descendantGroupIds (which
// includes the group itself, so a self-move is caught too).

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor } from '../context.js';
import { recordAudit } from '../../lib/audit.js';
import { descendantGroupIds } from '../../lib/groups.js';
import { isUuid } from '../../lib/ids.js';
import { generateCode } from '../studentCode.js';

function parseName(input) {
  if (typeof input !== 'string') return { error: 'Group name is required.' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return { error: 'Group name must be 1 to 60 characters.' };
  }
  return { value };
}

function parseCode(input) {
  if (input === undefined || input === null || String(input).trim() === '') {
    return { value: null }; // auto-generate
  }
  const code = String(input).trim();
  if (code.length < 1 || code.length > 40) {
    return { error: 'Group code must be 1 to 40 characters.' };
  }
  return { value: code };
}

function parseSortOrder(input) {
  if (!Number.isInteger(input) || input < 0) {
    return { error: 'Sort order must be a whole number from 0.' };
  }
  return { value: input };
}

async function loadGroup(db, id) {
  const result = await db.query(
    `SELECT id, code, name, sort_order AS "sortOrder",
            parent_id AS "parentId", archived_at AS "archivedAt"
     FROM student_groups WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

async function liveChildCount(db, id) {
  const result = await db.query(
    `SELECT count(*)::int AS count FROM student_groups
     WHERE parent_id = $1 AND archived_at IS NULL`,
    [id],
  );
  return result.rows[0].count;
}

// List groups. With `studentId` (a valid uuid), lists the live groups that
// student belongs to. Otherwise lists all groups with member counts; archived
// groups are included only when `includeArchived` is true.
// `options` = { studentId?, includeArchived? }.
export async function listGroups(options = {}) {
  const db = getDb();
  const { studentId } = options;
  const includeArchived = options.includeArchived === true;

  if (studentId !== undefined) {
    if (!isUuid(studentId)) {
      throw ServiceError.validation('studentId must be a valid ID.');
    }
    const result = await db.query(
      `SELECT g.id, g.name, g.parent_id AS "parentId"
       FROM student_groups g
       JOIN student_group_members m ON m.group_id = g.id
       WHERE m.student_id = $1 AND m.left_on IS NULL AND g.archived_at IS NULL
       ORDER BY lower(g.name)`,
      [studentId],
    );
    return { groups: result.rows };
  }

  const result = await db.query(
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
    [includeArchived],
  );
  return { groups: result.rows };
}

// List the (non-deleted) students that belong directly to a group.
export async function getGroupMembers(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Group not found.');

  const group = await loadGroup(db, id);
  if (!group) throw ServiceError.notFound('Group not found.');

  const result = await db.query(
    `SELECT s.id,
            s.full_name        AS "fullName",
            s.student_code     AS "studentCode",
            m.id                   AS "membershipId",
            m.joined_on::text AS "joinedOn",
            m.left_on::text        AS "leftOn"
     FROM student_group_members m
     JOIN students s ON s.id = m.student_id AND s.deleted_at IS NULL
     WHERE m.group_id = $1
     ORDER BY m.left_on IS NOT NULL, lower(s.full_name)`,
    [id],
  );
  return { students: result.rows };
}

// Create a group. `input` = { name, code?, sortOrder?, parentId? }. A parent,
// if given, must exist and be live. Duplicate sibling names collide (CONFLICT);
// an omitted code is auto-generated.
export async function createGroup(input = {}) {
  const db = getDb();

  const name = parseName(input.name);
  if (name.error) throw ServiceError.validation(name.error);
  const code = parseCode(input.code);
  if (code.error) throw ServiceError.validation(code.error);
  const sortOrder = parseSortOrder(input.sortOrder ?? 0);
  if (sortOrder.error) throw ServiceError.validation(sortOrder.error);

  const parentId = input.parentId ?? null;
  if (parentId !== null && !isUuid(parentId)) {
    throw ServiceError.validation('Choose a valid parent group.');
  }

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    if (parentId !== null) {
      const parent = await loadGroup(client, parentId);
      if (!parent || parent.archivedAt) {
        await client.query('ROLLBACK');
        throw ServiceError.validation('That parent group does not exist.');
      }
    }
    const inserted = await client.query(
      `INSERT INTO student_groups (name, code, sort_order, parent_id, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, code, name, sort_order AS "sortOrder",
                 parent_id AS "parentId", archived_at AS "archivedAt"`,
      [name.value, code.value ?? generateCode(), sortOrder.value, parentId, actor.userId],
    );
    const group = inserted.rows[0];
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'group.create',
      entityType: 'group',
      entityId: group.id,
      details: { name: group.name, parentId },
    });
    await client.query('COMMIT');
    return { group: { ...group, memberCount: 0 } };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505') {
      throw ServiceError.conflict('A group with that name already exists here.');
    }
    throw err;
  } finally {
    client.release();
  }
}

// Update a group. `changes` may include name, code (it cannot be cleared),
// sortOrder, parentId (null = top level), and archived. Moving a group under
// itself or a descendant is rejected (cycle); archiving a group that still has
// live subgroups is rejected.
export async function updateGroup(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Group not found.');

  const updates = {};
  if ('name' in changes) {
    const name = parseName(changes.name);
    if (name.error) throw ServiceError.validation(name.error);
    updates.name = name.value;
  }
  if ('parentId' in changes) {
    if (changes.parentId !== null && !isUuid(changes.parentId)) {
      throw ServiceError.validation('Choose a valid parent group.');
    }
    updates.parentId = changes.parentId;
  }
  if ('code' in changes) {
    const code = parseCode(changes.code);
    if (code.error) throw ServiceError.validation(code.error);
    if (code.value === null) {
      throw ServiceError.validation('A group code cannot be cleared.');
    }
    updates.code = code.value;
  }
  if ('sortOrder' in changes) {
    const sortOrder = parseSortOrder(changes.sortOrder);
    if (sortOrder.error) throw ServiceError.validation(sortOrder.error);
    updates.sortOrder = sortOrder.value;
  }
  if ('archived' in changes) {
    if (typeof changes.archived !== 'boolean') {
      throw ServiceError.validation('archived must be true or false.');
    }
    updates.archived = changes.archived;
  }
  if (Object.keys(updates).length === 0) {
    throw ServiceError.validation('Nothing to change.');
  }

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, id);
    if (!group) {
      await client.query('ROLLBACK');
      throw ServiceError.notFound('Group not found.');
    }

    if ('parentId' in updates && updates.parentId !== group.parentId) {
      if (updates.parentId !== null) {
        const parent = await loadGroup(client, updates.parentId);
        if (!parent || parent.archivedAt) {
          await client.query('ROLLBACK');
          throw ServiceError.validation('That parent group does not exist.');
        }
        // A group cannot move under itself or any of its own descendants.
        const descendants = await descendantGroupIds(client, group.id);
        if (descendants.includes(updates.parentId)) {
          await client.query('ROLLBACK');
          throw ServiceError.conflict(
            'A group cannot be moved inside itself or one of its subgroups.',
          );
        }
      }
    }

    if (updates.archived === true && !group.archivedAt) {
      if ((await liveChildCount(client, group.id)) > 0) {
        await client.query('ROLLBACK');
        throw ServiceError.conflict('Archive or move its subgroups first.');
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
       RETURNING id, name, parent_id AS "parentId", archived_at AS "archivedAt"`,
      values,
    );

    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'group.update',
      entityType: 'group',
      entityId: group.id,
      details: { name: updated.rows[0].name, changes: updates },
    });
    await client.query('COMMIT');
    return { group: updated.rows[0] };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505') {
      throw ServiceError.conflict('A group with that name already exists here.');
    }
    throw err;
  } finally {
    client.release();
  }
}

// Archive a group (never hard-deleted, to keep history). Idempotent for an
// already-archived group; refuses while it still has live subgroups.
export async function archiveGroup(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Group not found.');

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, id);
    if (!group) {
      await client.query('ROLLBACK');
      throw ServiceError.notFound('Group not found.');
    }
    if (group.archivedAt) {
      await client.query('ROLLBACK');
      return; // already archived — treat as done
    }
    if ((await liveChildCount(client, group.id)) > 0) {
      await client.query('ROLLBACK');
      throw ServiceError.conflict('Archive or move its subgroups first.');
    }
    await client.query(
      `UPDATE student_groups SET archived_at = now() WHERE id = $1`,
      [group.id],
    );
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'group.archive',
      entityType: 'group',
      entityId: group.id,
      details: { name: group.name },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Add and/or remove members. `changes` = { add?: uuid[], remove?: uuid[] }.
// Only non-deleted students are added; adding an existing member is a no-op.
// Returns { added, removed } (rows actually changed). Archived group → CONFLICT.
export async function setGroupMembers(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Group not found.');

  const add = Array.isArray(changes.add) ? changes.add : [];
  const remove = Array.isArray(changes.remove) ? changes.remove : [];
  if (![...add, ...remove].every((sid) => isUuid(sid))) {
    throw ServiceError.validation('Student ids must be valid IDs.');
  }

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const group = await loadGroup(client, id);
    if (!group) {
      await client.query('ROLLBACK');
      throw ServiceError.notFound('Group not found.');
    }
    if (group.archivedAt) {
      await client.query('ROLLBACK');
      throw ServiceError.conflict('This group is archived.');
    }

    let added = 0;
    let removed = 0;
    if (add.length > 0) {
      const result = await client.query(
        `INSERT INTO student_group_members (student_id, group_id, joined_on)
         SELECT s.id, $1, current_date
         FROM students s
         WHERE s.id = ANY($2::uuid[]) AND s.deleted_at IS NULL
         ON CONFLICT DO NOTHING`,
        [group.id, add],
      );
      added = result.rowCount;
    }
    if (remove.length > 0) {
      const result = await client.query(
        `UPDATE student_group_members
         SET left_on = current_date
         WHERE group_id = $1 AND student_id = ANY($2::uuid[]) AND left_on IS NULL`,
        [group.id, remove],
      );
      removed = result.rowCount;
    }

    if (added > 0 || removed > 0) {
      await recordAudit(client, {
        userId: actor.userId,
        actor: actor.actor,
        action: 'group.members',
        entityType: 'group',
        entityId: group.id,
        details: { name: group.name, added, removed },
      });
    }
    await client.query('COMMIT');
    return { added, removed };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
