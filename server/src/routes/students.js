import { Router } from 'express';
import pool from '../db/pool.js';
import { generateStudentCode } from '../lib/studentCode.js';
import {
  normalizeBirthDate,
  normalizeFatherName,
  normalizeFullName,
  normalizeGender,
  normalizeNationalId,
} from '../validation/student.js';
import { recordAudit } from '../lib/audit.js';
import { descendantGroupIds } from '../lib/groups.js';
import { stripRestricted, validateExtra } from '../lib/fields.js';
import { isUuid } from '../lib/ids.js';
import { userCan } from '../middleware/auth.js';
import {
  classifyStoredImport,
  importCounts,
  validateImportBody,
} from '../lib/studentImport.js';

const router = Router();

// Privacy applies to archived definitions too: stored values outlive archiving.
// Incoming writes are validated against the active subset below.
async function loadDefinitions(db) {
  const result = await db.query(
    `SELECT id, label, field_type AS "fieldType", choices,
            is_restricted AS "isRestricted", archived_at AS "archivedAt"
     FROM student_field_definitions`
  );
  return result.rows;
}

function presentStudent(student, definitions, canSeeRestricted) {
  return {
    ...student,
    extra: stripRestricted(definitions, student.extra, canSeeRestricted),
  };
}

const UNIQUE_VIOLATION = '23505';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SORTS = {
  newest: 'created_at DESC, id',
  oldest: 'created_at ASC, id',
  name: 'lower(full_name), id',
  code: 'student_code, id',
};

const STUDENT_COLUMNS = `
  id,
  student_code AS "studentCode",
  full_name    AS "fullName",
  gender,
  birth_date   AS "birthDate",
  father_name  AS "fatherName",
  national_id  AS "nationalId",
  extra,
  created_at   AS "createdAt"
`;

// Parse the required identity fields from a request body. Returns
// { values: { gender, birthDate, fatherName, nationalId } } or { error }.
function parseIdentity(body) {
  const gender = normalizeGender(body?.gender);
  if (gender.error) return gender;
  const birthDate = normalizeBirthDate(body?.birthDate);
  if (birthDate.error) return birthDate;
  const fatherName = normalizeFatherName(body?.fatherName);
  if (fatherName.error) return fatherName;
  const nationalId = normalizeNationalId(body?.nationalId);
  if (nationalId.error) return nationalId;
  return {
    values: {
      gender: gender.value,
      birthDate: birthDate.value,
      fatherName: fatherName.value,
      nationalId: nationalId.value,
    },
  };
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

router.param('id', (req, res, next, value) => {
  if (!UUID_PATTERN.test(value)) {
    return res
      .status(404)
      .json({ error: 'Student not found.', code: 'NOT_FOUND', params: { entity: 'student' } });
  }
  next();
});

router.post('/', async (req, res) => {
  const parsed = normalizeFullName(req.body?.fullName);
  if (parsed.error) {
    return res
      .status(400)
      .json({ error: parsed.error, code: parsed.code, params: parsed.params });
  }

  const identity = parseIdentity(req.body);
  if (identity.error) {
    return res.status(400).json({
      error: identity.error,
      code: identity.code,
      params: identity.params,
    });
  }

  const definitions = await loadDefinitions(pool);
  const canSeeRestricted = userCan(req, 'fields.view_restricted');
  const writableDefs = definitions.filter(
    (def) => !def.archivedAt && (canSeeRestricted || !def.isRestricted)
  );
  const extra = validateExtra(writableDefs, req.body?.extra ?? {});
  if (extra.error) {
    return res
      .status(400)
      .json({ error: extra.error, code: extra.code, params: extra.params });
  }
  const { gender, birthDate, fatherName, nationalId } = identity.values;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const result = await pool.query(
        `INSERT INTO students
           (student_code, full_name, gender, birth_date, father_name, national_id, extra)
         VALUES ($1, $2, $3::gender_type, $4::date, $5, $6, $7::jsonb)
         RETURNING ${STUDENT_COLUMNS}`,
        [
          generateStudentCode(),
          parsed.value,
          gender,
          birthDate,
          fatherName,
          nationalId,
          JSON.stringify(extra.value),
        ]
      );
      return res
        .status(201)
        .json(presentStudent(result.rows[0], definitions, canSeeRestricted));
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION) throw err;
      if (err.constraint === 'students_national_id_unique') {
        return res.status(409).json({
          error: 'That national ID already belongs to another student.',
          code: 'VALIDATION_NOT_UNIQUE',
        });
      }
    }
  }

  res.status(500).json({
    error: 'Could not create a unique student code. Please try again.',
    code: 'STUDENTS_CODE_GENERATION_FAILED',
  });
});

router.get('/', async (req, res) => {
  const search =
    typeof req.query.search === 'string' ? req.query.search.trim() : '';
  if (search.length > 100) {
    return res.status(400).json({
      error: 'Search text is too long.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 100 },
    });
  }

  const page = Math.min(toPositiveInt(req.query.page, 1), 1_000_000);
  const pageSize = Math.min(
    toPositiveInt(req.query.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE
  );
  const sort = req.query.sort ?? 'newest';
  if (typeof sort !== 'string' || !Object.hasOwn(SORTS, sort)) {
    return res.status(400).json({
      error: 'Unknown sort order.',
      code: 'VALIDATION_INVALID_CHOICE',
    });
  }

  const { groupId } = req.query;
  if (groupId !== undefined && !isUuid(groupId)) {
    return res.status(400).json({
      error: 'groupId must be a valid ID.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { field: 'groupId' },
    });
  }

  const conditions = [req.query.archived === '1' ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const values = [];

  if (groupId !== undefined) {
    // Filtering by a group includes every student in it or its subgroups.
    const groupIds = await descendantGroupIds(pool, groupId);
    values.push(groupIds);
    conditions.push(
      `id IN (SELECT student_id FROM student_group_members
              WHERE group_id = ANY($${values.length}::uuid[]) AND left_on IS NULL)`
    );
  }

  if (search) {
    values.push(`%${escapeLike(search)}%`);
    let condition = `full_name ILIKE $${values.length}`;

    const codeText = search.replace(/[-\s]/g, '');
    if (codeText) {
      values.push(`%${escapeLike(codeText)}%`);
      condition += ` OR student_code ILIKE $${values.length}`;
      // A bare 10-digit search also matches a national ID exactly.
      if (/^[0-9]{10}$/.test(codeText)) {
        values.push(codeText);
        condition += ` OR national_id = $${values.length}`;
      }
    }
    conditions.push(`(${condition})`);
  }

  const where = conditions.join(' AND ');

  const countResult = await pool.query(
    `SELECT count(*)::int AS total FROM students WHERE ${where}`,
    values
  );

  const listResult = await pool.query(
    `SELECT ${STUDENT_COLUMNS}
     FROM students
     WHERE ${where}
     ORDER BY ${SORTS[sort]}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  const definitions = await loadDefinitions(pool);
  const canSeeRestricted = userCan(req, 'fields.view_restricted');

  res.json({
    students: listResult.rows.map((student) =>
      presentStudent(student, definitions, canSeeRestricted)
    ),
    total: countResult.rows[0].total,
    page,
    pageSize,
  });
});

router.patch('/:id', async (req, res) => {
  const body =
    req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
      ? req.body
      : {};
  if ('studentCode' in body) {
    return res.status(400).json({
      error: 'Student codes cannot be changed.',
      code: 'STUDENTS_CODE_IMMUTABLE',
    });
  }

  const hasName = 'fullName' in body;
  const hasExtra = 'extra' in body;
  const IDENTITY_FIELDS = ['gender', 'birthDate', 'fatherName', 'nationalId'];
  const identityPresent = IDENTITY_FIELDS.filter((field) => field in body);
  if (!hasName && !hasExtra && identityPresent.length === 0) {
    return res.status(400).json({
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    });
  }

  const sets = [];
  const values = [];

  if (hasName) {
    const parsed = normalizeFullName(body.fullName);
    if (parsed.error) {
      return res
        .status(400)
        .json({ error: parsed.error, code: parsed.code, params: parsed.params });
    }
    values.push(parsed.value);
    sets.push(`full_name = $${values.length}`);
  }

  if (identityPresent.length > 0) {
    const normalizers = { gender: normalizeGender, birthDate: normalizeBirthDate,
      fatherName: normalizeFatherName, nationalId: normalizeNationalId };
    const COLUMN_OF = {
      gender: ['gender', '$::gender_type'],
      birthDate: ['birth_date', '$::date'],
      fatherName: ['father_name', '$'],
      nationalId: ['national_id', '$'],
    };
    for (const field of identityPresent) {
      const parsed = normalizers[field](body[field]);
      if (parsed.error) return res.status(400).json(parsed);
      const [column, placeholder] = COLUMN_OF[field];
      values.push(parsed.value);
      sets.push(`${column} = ${placeholder.replace('$', `$${values.length}`)}`);
    }
  }

  const definitions = await loadDefinitions(pool);
  const canSeeRestricted = userCan(req, 'fields.view_restricted');
  const writableDefs = definitions.filter(
    (def) => !def.archivedAt && (canSeeRestricted || !def.isRestricted)
  );
  if (hasExtra) {
    const extra = validateExtra(writableDefs, body.extra);
    if (extra.error) {
      return res
        .status(400)
        .json({ error: extra.error, code: extra.code, params: extra.params });
    }
    // Keys sent as empty/null are cleared; the rest are merged in.
    const clearKeys = Object.keys(body.extra).filter(
      (key) => !(key in extra.value)
    );
    values.push(JSON.stringify(extra.value));
    const mergeIndex = values.length;
    values.push(clearKeys);
    const clearIndex = values.length;
    sets.push(
      `extra = (extra || $${mergeIndex}::jsonb) - $${clearIndex}::text[]`
    );
  }

  values.push(req.params.id);
  let result;
  try {
    result = await pool.query(
      `UPDATE students
       SET ${sets.join(', ')}
       WHERE id = $${values.length} AND deleted_at IS NULL
       RETURNING ${STUDENT_COLUMNS}`,
      values
    );
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION && err.constraint === 'students_national_id_unique') {
      return res.status(409).json({
        error: 'That national ID already belongs to another student.',
        code: 'VALIDATION_NOT_UNIQUE',
      });
    }
    throw err;
  }

  if (result.rowCount === 0) {
    return res
      .status(404)
      .json({ error: 'Student not found.', code: 'NOT_FOUND', params: { entity: 'student' } });
  }
  res.json(presentStudent(result.rows[0], definitions, canSeeRestricted));
});

router.delete('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');
    const student = await client.query(
      `SELECT id FROM students
       WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [req.params.id]
    );
    if (student.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        error: 'Student not found.', code: 'NOT_FOUND', params: { entity: 'student' },
      });
    }
    const balance = await client.query(
      `SELECT balance FROM student_balances WHERE student_id = $1 FOR UPDATE`,
      [req.params.id]
    );
    if (BigInt(balance.rows[0]?.balance ?? 0) !== 0n) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        error: 'Settle or refund the student balance before deleting the student.',
        code: 'STUDENTS_BALANCE_NOT_ZERO',
      });
    }
    await client.query(
      `UPDATE students SET deleted_at = now() WHERE id = $1`,
      [req.params.id]
    );
    await client.query('COMMIT');
    res.status(204).end();
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.get('/:id', async (req, res) => {
  const result = await pool.query(
    `SELECT ${STUDENT_COLUMNS}
     FROM students
     WHERE id = $1 AND deleted_at IS NULL`,
    [req.params.id]
  );
  if (result.rowCount === 0) {
    return res
      .status(404)
      .json({ error: 'Student not found.', code: 'NOT_FOUND', params: { entity: 'student' } });
  }
  const definitions = await loadDefinitions(pool);
  const canSeeRestricted = userCan(req, 'fields.view_restricted');
  res.json(presentStudent(result.rows[0], definitions, canSeeRestricted));
});
router.post('/import', async (req, res) => {
  const parsed = validateImportBody(req.body);
  if (parsed.error) {
    return res.status(400).json({
      error: parsed.error,
      code: parsed.code,
      params: parsed.params,
    });
  }
  const { rows, allowDuplicateNames, dryRun } = parsed;

  let classified = await classifyStoredImport(pool, { rows, allowDuplicateNames });
  let counts = importCounts(classified);

  if (dryRun) {
    return res.json({ dryRun: true, rows: classified, counts });
  }
  if (counts.willImport === 0) {
    return res.status(400).json({
      error: 'There are no rows to import.',
      code: 'STUDENTS_IMPORT_EMPTY',
      rows: classified,
      counts,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');

    const created = [];
    // Reclassify after acquiring the write gate: another import may have
    // committed the same identity/name since the preview.
    classified = await classifyStoredImport(client, { rows, allowDuplicateNames });
    counts = importCounts(classified);
    if (counts.willImport === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'There are no rows to import.', code: 'STUDENTS_IMPORT_EMPTY', rows: classified, counts });
    }
    for (const item of classified) {
      if (!item.willImport) continue;

      let student = null;
      for (let attempt = 1; attempt <= 5 && student === null; attempt++) {
        const inserted = await client.query(
          `INSERT INTO students (student_code, full_name, gender, birth_date, father_name, national_id)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (student_code) DO NOTHING
           RETURNING ${STUDENT_COLUMNS}`,
          [generateStudentCode(), item.fullName, item.gender, item.birthDate, item.fatherName, item.nationalId]
        );
        student = inserted.rows[0] ?? null;
      }
      if (student === null) {
        throw new Error('Could not create a unique student code.');
      }
      created.push({ row: item.row, ...student });
    }

    await recordAudit(client, {
      userId: req.user.id,
      actor: req.user.username,
      action: 'student.import',
      entityType: 'student',
      details: {
        count: created.length,
        skipped: classified.length - created.length,
        allowDuplicateNames,
        students: created.slice(0, 50).map((student) => ({
          fullName: student.fullName,
          studentCode: student.studentCode,
        })),
        moreStudents: Math.max(0, created.length - 50),
      },
    });

    await client.query('COMMIT');
    res.status(201).json({ dryRun: false, created, rows: classified, counts });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
});

router.put('/:id/restore', async (req, res) => {
  const result = await pool.query('UPDATE students SET deleted_at=NULL WHERE id=$1 RETURNING id', [req.params.id]);
  if (!result.rowCount) return res.status(404).json({ error: 'Student not found.', code: 'NOT_FOUND' });
  res.json({ student: result.rows[0] });
});

export default router;
