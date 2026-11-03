// Custom student fields — service layer (framework-free).
//
// Test-only framework-free equivalent of routes/fieldDefinitions.js. Same peeling as
// services/students.js: plain args in, plain data out, ServiceError instead of
// status codes, getDb() for the pool, getLocalActor() for the audit trail, and
// no permission gating (the single user is the admin). The route's two local
// helpers (parseLabel / parseChoices) are pure, so they move here verbatim.
//
// The route exposed `seeAll` (fields.view_restricted OR fields.manage) to decide
// whether restricted definitions are listed; for the single admin that is always
// true, so listFields returns restricted fields too.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor } from '../context.js';
import { recordAudit } from '../../lib/audit.js';
import { FIELD_TYPES } from '../../lib/fields.js';
import { isUuid } from '../../lib/ids.js';

const DEFINITION_COLUMNS = `
  id,
  label,
  field_type    AS "fieldType",
  choices,
  is_restricted AS "isRestricted",
  sort_order    AS "sortOrder",
  archived_at   AS "archivedAt"
`;

function parseLabel(input) {
  if (typeof input !== 'string') return { error: 'Field label is required.' };
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return { error: 'Field label must be 1 to 60 characters.' };
  }
  return { value };
}

function parseChoices(input) {
  if (input === undefined) return { value: [] };
  if (!Array.isArray(input)) return { error: 'Choices must be a list.' };
  const seen = new Set();
  const value = [];
  for (const choice of input) {
    if (typeof choice !== 'string') return { error: 'Each choice must be text.' };
    const trimmed = choice.trim();
    if (trimmed === '') continue;
    if (trimmed.length > 60) return { error: 'A choice is too long (max 60).' };
    if (!seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      value.push(trimmed);
    }
  }
  return { value };
}

// List field definitions. The single admin sees restricted fields; archived
// ones are included only when asked. `options` = { includeArchived? }.
export async function listFields(options = {}) {
  const db = getDb();
  const includeArchived = options.includeArchived === true;

  const result = await db.query(
    `SELECT ${DEFINITION_COLUMNS}
     FROM student_field_definitions
     WHERE ($1 OR archived_at IS NULL)
     ORDER BY sort_order, lower(label)`,
    [includeArchived],
  );
  return { fields: result.rows };
}

// Create a field definition. `input` = { label, fieldType, choices?, isRestricted? }.
export async function createField(input = {}) {
  const db = getDb();

  const label = parseLabel(input.label);
  if (label.error) throw ServiceError.validation(label.error);

  const fieldType = input.fieldType;
  if (!FIELD_TYPES.includes(fieldType)) {
    throw ServiceError.validation('Choose a valid field type.');
  }
  const choices = parseChoices(input.choices);
  if (choices.error) throw ServiceError.validation(choices.error);
  if (fieldType === 'choice' && choices.value.length === 0) {
    throw ServiceError.validation('A choice field needs at least one choice.');
  }
  const isRestricted = input.isRestricted === true;
  const actor = getLocalActor();

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const orderResult = await client.query(
      `SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM student_field_definitions`,
    );
    const inserted = await client.query(
      `INSERT INTO student_field_definitions
         (label, field_type, choices, is_restricted, sort_order, created_by)
       VALUES ($1, $2, $3::jsonb, $4, $5, $6)
       RETURNING ${DEFINITION_COLUMNS}`,
      [
        label.value,
        fieldType,
        JSON.stringify(fieldType === 'choice' ? choices.value : []),
        isRestricted,
        orderResult.rows[0].next,
        actor.userId,
      ],
    );
    const field = inserted.rows[0];
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'field.create',
      entityType: 'field',
      entityId: field.id,
      details: { label: field.label, fieldType, isRestricted },
    });
    await client.query('COMMIT');
    return { field };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      throw ServiceError.conflict('A field with that label already exists.');
    }
    throw err;
  } finally {
    client.release();
  }
}

// Update a field definition. `changes` may include label, isRestricted,
// sortOrder, choices (choice fields only), and archived. Field type is
// immutable. Refuses to drop a choice a student still uses.
export async function updateField(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Field not found.');

  if ('fieldType' in changes) {
    throw ServiceError.validation(
      'A field type cannot be changed. Create a new field instead.',
    );
  }

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const existingResult = await client.query(
      `SELECT ${DEFINITION_COLUMNS} FROM student_field_definitions
       WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (existingResult.rowCount === 0) {
      await client.query('ROLLBACK');
      throw ServiceError.notFound('Field not found.');
    }
    const field = existingResult.rows[0];

    const sets = [];
    const values = [];

    if ('label' in changes) {
      const label = parseLabel(changes.label);
      if (label.error) {
        await client.query('ROLLBACK');
        throw ServiceError.validation(label.error);
      }
      values.push(label.value);
      sets.push(`label = $${values.length}`);
    }
    if ('isRestricted' in changes) {
      if (typeof changes.isRestricted !== 'boolean') {
        await client.query('ROLLBACK');
        throw ServiceError.validation('isRestricted must be true or false.');
      }
      values.push(changes.isRestricted);
      sets.push(`is_restricted = $${values.length}`);
    }
    if ('sortOrder' in changes) {
      if (!Number.isInteger(changes.sortOrder)) {
        await client.query('ROLLBACK');
        throw ServiceError.validation('sortOrder must be a whole number.');
      }
      values.push(changes.sortOrder);
      sets.push(`sort_order = $${values.length}`);
    }
    if ('choices' in changes) {
      if (field.fieldType !== 'choice') {
        await client.query('ROLLBACK');
        throw ServiceError.validation('Only choice fields have choices.');
      }
      const choices = parseChoices(changes.choices);
      if (choices.error) {
        await client.query('ROLLBACK');
        throw ServiceError.validation(choices.error);
      }
      if (choices.value.length === 0) {
        await client.query('ROLLBACK');
        throw ServiceError.validation('A choice field needs at least one choice.');
      }
      // Don't remove a choice that some student is currently using.
      const usedResult = await client.query(
        `SELECT DISTINCT extra->>$1 AS value
         FROM students
         WHERE extra ? $1 AND deleted_at IS NULL`,
        [field.id],
      );
      const used = usedResult.rows.map((row) => row.value).filter(Boolean);
      const removed = used.filter((value) => !choices.value.includes(value));
      if (removed.length > 0) {
        await client.query('ROLLBACK');
        throw ServiceError.conflict(
          `These choices are still in use and cannot be removed: ${removed.join(', ')}.`,
        );
      }
      values.push(JSON.stringify(choices.value));
      sets.push(`choices = $${values.length}::jsonb`);
    }
    if ('archived' in changes) {
      if (typeof changes.archived !== 'boolean') {
        await client.query('ROLLBACK');
        throw ServiceError.validation('archived must be true or false.');
      }
      sets.push(`archived_at = ${changes.archived ? 'now()' : 'NULL'}`);
    }

    if (sets.length === 0) {
      await client.query('ROLLBACK');
      throw ServiceError.validation('Nothing to change.');
    }

    values.push(field.id);
    const updated = await client.query(
      `UPDATE student_field_definitions SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${DEFINITION_COLUMNS}`,
      values,
    );
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'field.update',
      entityType: 'field',
      entityId: field.id,
      details: { label: updated.rows[0].label },
    });
    await client.query('COMMIT');
    return { field: updated.rows[0] };
  } catch (err) {
    // ServiceError paths above already rolled back; a second ROLLBACK with no
    // open transaction is a harmless no-op. The 23505 path (unique label on
    // UPDATE) reaches here with the transaction still open, so roll back here.
    await client.query('ROLLBACK').catch(() => {});
    if (err && err.code === '23505') {
      throw ServiceError.conflict('A field with that label already exists.');
    }
    throw err;
  } finally {
    client.release();
  }
}

// Archive a field (values stay in students.extra, just hidden). Idempotent:
// archiving an already-archived field is a no-op success. A missing field is
// NOT_FOUND, matching the route's 404-vs-204 split.
export async function archiveField(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Field not found.');

  const actor = getLocalActor();
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const updated = await client.query(
      `UPDATE student_field_definitions SET archived_at = now()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, label`,
      [id],
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      const exists = await client.query(
        'SELECT 1 FROM student_field_definitions WHERE id = $1',
        [id],
      );
      if (exists.rowCount === 0) throw ServiceError.notFound('Field not found.');
      return; // already archived — treat as done
    }
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
      action: 'field.archive',
      entityType: 'field',
      entityId: updated.rows[0].id,
      details: { label: updated.rows[0].label },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
