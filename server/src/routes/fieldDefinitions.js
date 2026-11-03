import { Router } from 'express';
import pool from '../db/pool.js';
import { recordAudit } from '../lib/audit.js';
import { FIELD_TYPES } from '../lib/fields.js';
import { isUuid } from '../lib/ids.js';
import { userCan } from '../middleware/auth.js';

const router = Router();
const UNIQUE_VIOLATION = '23505';

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
  if (typeof input !== 'string') {
    return { error: 'Field label is required.', code: 'VALIDATION_REQUIRED' };
  }
  const value = input.trim().replace(/\s+/g, ' ');
  if (value.length < 1 || value.length > 60) {
    return {
      error: 'Field label must be 1 to 60 characters.',
      code: 'VALIDATION_INVALID_LENGTH',
      params: { min: 1, max: 60 },
    };
  }
  return { value };
}

function parseChoices(input) {
  if (input === undefined) return { value: [] };
  if (!Array.isArray(input)) {
    return { error: 'Choices must be a list.', code: 'VALIDATION_INVALID_TYPE' };
  }
  const seen = new Set();
  const value = [];
  for (const choice of input) {
    if (typeof choice !== 'string') {
      return {
        error: 'Each choice must be text.',
        code: 'VALIDATION_INVALID_TYPE',
      };
    }
    const trimmed = choice.trim();
    if (trimmed === '') continue;
    if (trimmed.length > 60) {
      return {
        error: 'A choice is too long (max 60).',
        code: 'VALIDATION_TOO_LONG',
        params: { max: 60 },
      };
    }
    if (!seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      value.push(trimmed);
    }
  }
  return { value };
}

router.param('id', (req, res, next, value) => {
  if (!isUuid(value)) {
    return res
      .status(404)
      .json({ error: 'Field not found.', code: 'NOT_FOUND', params: { entity: 'field' } });
  }
  next();
});

router.get('/', async (req, res) => {
  const includeArchived = req.query.includeArchived === '1';
  const seeAll = userCan(req, 'fields.view_restricted') || userCan(req, 'fields.manage');

  const result = await pool.query(
    `SELECT ${DEFINITION_COLUMNS}
     FROM student_field_definitions
     WHERE ($1 OR archived_at IS NULL)
       AND ($2 OR is_restricted = false)
     ORDER BY sort_order, lower(label)`,
    [includeArchived, seeAll]
  );
  res.json({ fields: result.rows });
});

router.post('/', async (req, res) => {
  const label = parseLabel(req.body?.label);
  if (label.error) {
    return res
      .status(400)
      .json({ error: label.error, code: label.code, params: label.params });
  }

  const fieldType = req.body?.fieldType;
  if (!FIELD_TYPES.includes(fieldType)) {
    return res.status(400).json({
      error: 'Choose a valid field type.',
      code: 'VALIDATION_INVALID_CHOICE',
    });
  }
  const choices = parseChoices(req.body?.choices);
  if (choices.error) {
    return res
      .status(400)
      .json({ error: choices.error, code: choices.code, params: choices.params });
  }
  if (fieldType === 'choice' && choices.value.length === 0) {
    return res.status(400).json({
      error: 'A choice field needs at least one choice.',
      code: 'FIELDS_CHOICES_REQUIRED',
    });
  }
  const isRestricted = req.body?.isRestricted === true;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const orderResult = await client.query(
      `SELECT COALESCE(max(sort_order), 0) + 1 AS next FROM student_field_definitions`
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
        req.user.id,
      ]
    );
    const field = inserted.rows[0];
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'field.create',
      entityType: 'field',
      entityId: field.id,
      details: { label: field.label, fieldType, isRestricted },
    });
    await client.query('COMMIT');
    res.status(201).json({ field });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'A field with that label already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

router.patch('/:id', async (req, res) => {
  const body = req.body ?? {};
  if ('fieldType' in body) {
    return res.status(400).json({
      error: 'A field type cannot be changed. Create a new field instead.',
      code: 'FIELDS_TYPE_IMMUTABLE',
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const existingResult = await client.query(
      `SELECT ${DEFINITION_COLUMNS} FROM student_field_definitions
       WHERE id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (existingResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res
        .status(404)
        .json({ error: 'Field not found.', code: 'NOT_FOUND', params: { entity: 'field' } });
    }
    const field = existingResult.rows[0];

    const sets = [];
    const values = [];

    if ('label' in body) {
      const label = parseLabel(body.label);
      if (label.error) {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ error: label.error, code: label.code, params: label.params });
      }
      values.push(label.value);
      sets.push(`label = $${values.length}`);
    }
    if ('isRestricted' in body) {
      if (typeof body.isRestricted !== 'boolean') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'isRestricted must be true or false.',
          code: 'VALIDATION_INVALID_TYPE',
        });
      }
      values.push(body.isRestricted);
      sets.push(`is_restricted = $${values.length}`);
    }
    if ('sortOrder' in body) {
      if (!Number.isInteger(body.sortOrder)) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'sortOrder must be a whole number.',
          code: 'VALIDATION_INVALID_TYPE',
          params: { field: 'sortOrder' },
        });
      }
      values.push(body.sortOrder);
      sets.push(`sort_order = $${values.length}`);
    }
    if ('choices' in body) {
      if (field.fieldType !== 'choice') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Only choice fields have choices.',
          code: 'FIELDS_CHOICES_NOT_ALLOWED',
        });
      }
      const choices = parseChoices(body.choices);
      if (choices.error) {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ error: choices.error, code: choices.code, params: choices.params });
      }
      if (choices.value.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'A choice field needs at least one choice.',
          code: 'FIELDS_CHOICES_REQUIRED',
        });
      }
      // Don't remove a choice that some student is currently using.
      const usedResult = await client.query(
        `SELECT DISTINCT extra->>$1 AS value
         FROM students
         WHERE extra ? $1 AND deleted_at IS NULL`,
        [field.id]
      );
      const used = usedResult.rows.map((row) => row.value).filter(Boolean);
      const removed = used.filter((value) => !choices.value.includes(value));
      if (removed.length > 0) {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: `These choices are still in use and cannot be removed: ${removed.join(', ')}.`,
          code: 'FIELDS_CHOICES_IN_USE',
          params: { choices: removed },
        });
      }
      values.push(JSON.stringify(choices.value));
      sets.push(`choices = $${values.length}::jsonb`);
    }
    if ('archived' in body) {
      if (typeof body.archived !== 'boolean') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'archived must be true or false.',
          code: 'VALIDATION_INVALID_TYPE',
        });
      }
      sets.push(`archived_at = ${body.archived ? 'now()' : 'NULL'}`);
    }

    if (sets.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Nothing to change.',
        code: 'VALIDATION_NOTHING_TO_CHANGE',
      });
    }

    values.push(field.id);
    const updated = await client.query(
      `UPDATE student_field_definitions SET ${sets.join(', ')}
       WHERE id = $${values.length}
       RETURNING ${DEFINITION_COLUMNS}`,
      values
    );
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'field.update',
      entityType: 'field',
      entityId: field.id,
      details: { label: updated.rows[0].label },
    });
    await client.query('COMMIT');
    res.json({ field: updated.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      return res.status(409).json({
        error: 'A field with that label already exists.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  } finally {
    client.release();
  }
});

// DELETE archives the field (values stay in students.extra, just hidden).
router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const updated = await client.query(
      `UPDATE student_field_definitions SET archived_at = now()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id, label`,
      [req.params.id]
    );
    if (updated.rowCount === 0) {
      await client.query('ROLLBACK');
      // Either it doesn't exist or it's already archived; treat as done.
      const exists = await client.query(
        'SELECT 1 FROM student_field_definitions WHERE id = $1',
        [req.params.id]
      );
      return exists.rowCount === 0
        ? res
            .status(404)
            .json({ error: 'Field not found.', code: 'NOT_FOUND', params: { entity: 'field' } })
        : res.status(204).end();
    }
    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'field.archive',
      entityType: 'field',
      entityId: updated.rows[0].id,
      details: { label: updated.rows[0].label },
    });
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

export default router;
