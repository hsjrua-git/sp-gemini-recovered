// Students — service layer (framework-free).
//
// Test-only framework-free equivalent of routes/students.js. The HTTP handlers
// have been peeled apart into plain async functions: no Express req/res, no
// permission middleware, no status codes. Input arrives as plain arguments;
// success returns plain data; failure throws a ServiceError (see errors.js).
//
// What changed vs the route, and why:
//   * The shared `pool` is fetched via getDb() (initialised once at startup),
//     mirroring how the route imported the pg pool singleton.
//   * userCan(req, 'fields.view_restricted') is gone: the single user is the
//     admin, so CAN_SEE_RESTRICTED is always true (context.js). presentStudent
//     still runs stripRestricted for parity, so re-adding roles later is a
//     one-line change rather than a rewrite.
//   * The audit actor is the fixed LOCAL_ACTOR instead of req.user.
//   * Unique student-code collisions are handled with ON CONFLICT DO NOTHING +
//     retry (the pattern the import already used) rather than catching SQLSTATE
//     23505 — one code path, and no dependency on driver error-code fidelity.
//
// Everything reused from ../../lib and ../../validation is already pure and
// browser-safe; only the Node-only code generator is swapped for the portable
// one in ../studentCode.js.

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalActor, CAN_SEE_RESTRICTED } from '../context.js';
import { generateStudentCode } from '../studentCode.js';
import {
  normalizeFullName,
  normalizeGender,
  normalizeBirthDate,
  normalizeFatherName,
  normalizeNationalId,
} from '../../validation/student.js';
import { recordAudit } from '../../lib/audit.js';
import { descendantGroupIds } from '../../lib/groups.js';
import { stripRestricted, validateExtra } from '../../lib/fields.js';
import { isUuid } from '../../lib/ids.js';
import {
  classifyStoredImport,
  importCounts,
  validateImportBody,
} from '../../lib/studentImport.js';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const MAX_CODE_ATTEMPTS = 5;

// Whitelisted sort orders (never interpolate a user string into SQL).
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
  birth_date::text AS "birthDate",
  father_name  AS "fatherName",
  national_id  AS "nationalId",
  extra,
  created_at   AS "createdAt"
`;

// The live custom-field definitions: used to validate incoming values and to
// strip restricted values from responses.
async function loadDefinitions(db) {
  const result = await db.query(
    `SELECT id, label, field_type AS "fieldType", choices,
            is_restricted AS "isRestricted"
     FROM student_field_definitions
     WHERE archived_at IS NULL`,
  );
  return result.rows;
}

function presentStudent(student, definitions) {
  return {
    ...student,
    extra: stripRestricted(definitions, student.extra, CAN_SEE_RESTRICTED),
  };
}

function toPositiveInt(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function escapeLike(text) {
  return text.replace(/[\\%_]/g, '\\$&');
}

// Insert a student, retrying on the (vanishingly rare) student-code collision.
// Returns the inserted row, or null if every attempt collided.
async function insertWithUniqueCode(db, columns, values, extra) {
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
    const result = await db.query(
      `INSERT INTO students (${columns})
       VALUES (${values})
       ON CONFLICT (student_code) DO NOTHING
       RETURNING ${STUDENT_COLUMNS}`,
      extra(generateStudentCode()),
    );
    if (result.rows[0]) return result.rows[0];
  }
  return null;
}

// Create a student. Identity fields are required; custom extra fields are optional.
export async function createStudent(input = {}) {
  const db = getDb();

  const parsed = normalizeFullName(input.fullName);
  if (parsed.error) throw ServiceError.validation(parsed.error);
  const gender = normalizeGender(input.gender);
  if (gender.error) throw ServiceError.validation(gender.error);
  const birthDate = normalizeBirthDate(input.birthDate);
  if (birthDate.error) throw ServiceError.validation(birthDate.error);
  const fatherName = normalizeFatherName(input.fatherName);
  if (fatherName.error) throw ServiceError.validation(fatherName.error);
  const nationalId = normalizeNationalId(input.nationalId);
  if (nationalId.error) throw ServiceError.validation(nationalId.error);

  const definitions = await loadDefinitions(db);
  const writableDefs = CAN_SEE_RESTRICTED
    ? definitions
    : definitions.filter((d) => !d.isRestricted);
  const extra = validateExtra(writableDefs, input.extra ?? {});
  if (extra.error) throw ServiceError.validation(extra.error);

  let student;
  try {
    student = await insertWithUniqueCode(
      db,
      'student_code, full_name, gender, birth_date, father_name, national_id, extra',
      '$1, $2, $3, $4, $5, $6, $7::jsonb',
      (code) => [
        code,
        parsed.value,
        gender.value,
        birthDate.value,
        fatherName.value,
        nationalId.value,
        JSON.stringify(extra.value),
      ],
    );
  } catch (err) {
    if (err && err.code === '23505' && err.constraint === 'students_national_id_unique') {
      throw ServiceError.conflict('A student with that National ID already exists.');
    }
    throw err;
  }
  if (student === null) {
    throw ServiceError.conflict(
      'Could not create a unique student code. Please try again.',
    );
  }
  const actor = getLocalActor();
  await recordAudit(db, {
    userId: actor.userId,
    actor: actor.actor,
    action: 'student.create',
    entityType: 'student',
    entityId: student.id,
    details: { fullName: student.fullName, studentCode: student.studentCode },
  });
  return presentStudent(student, definitions);
}

// List students with search / paging / sort / group filtering.
// `query` = { search?, page?, pageSize?, sort?, groupId? }.
export async function listStudents(query = {}) {
  const db = getDb();

  const search = typeof query.search === 'string' ? query.search.trim() : '';
  if (search.length > 100) {
    throw ServiceError.validation('Search text is too long.');
  }

  const page = Math.min(toPositiveInt(query.page, 1), 1_000_000);
  const pageSize = Math.min(
    toPositiveInt(query.pageSize, DEFAULT_PAGE_SIZE),
    MAX_PAGE_SIZE,
  );

  const sort = query.sort ?? 'newest';
  if (typeof sort !== 'string' || !Object.hasOwn(SORTS, sort)) {
    throw ServiceError.validation('Unknown sort order.');
  }

  const { groupId } = query;
  if (groupId !== undefined && !isUuid(groupId)) {
    throw ServiceError.validation('groupId must be a valid ID.');
  }

  const conditions = ['deleted_at IS NULL'];
  const values = [];

  if (groupId !== undefined) {
    // Filtering by a group includes every active student in it or its subgroups.
    const groupIds = await descendantGroupIds(db, groupId);
    values.push(groupIds);
    conditions.push(
      `id IN (SELECT student_id FROM student_group_members
              WHERE group_id = ANY($${values.length}::uuid[]) AND left_on IS NULL)`,
    );
  }

  if (search) {
    values.push(`%${escapeLike(search)}%`);
    let condition = `full_name ILIKE $${values.length}`;

    const codeText = search.replace(/[-\s]/g, '');
    if (codeText) {
      values.push(`%${escapeLike(codeText)}%`);
      condition += ` OR student_code ILIKE $${values.length}`;
      if (/^[0-9]{10}$/.test(codeText)) {
        values.push(codeText);
        condition += ` OR national_id = $${values.length}`;
      }
    }
    conditions.push(`(${condition})`);
  }

  const where = conditions.join(' AND ');

  const countResult = await db.query(
    `SELECT count(*)::int AS total FROM students WHERE ${where}`,
    values,
  );

  const listResult = await db.query(
    `SELECT ${STUDENT_COLUMNS}
     FROM students
     WHERE ${where}
     ORDER BY ${SORTS[sort]}
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, pageSize, (page - 1) * pageSize],
  );

  const definitions = await loadDefinitions(db);
  return {
    students: listResult.rows.map((student) =>
      presentStudent(student, definitions),
    ),
    total: countResult.rows[0].total,
    page,
    pageSize,
  };
}

// Fetch one student by id. A malformed id is treated as "not found", exactly
// as the route's router.param guard returned a 404.
export async function getStudent(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Student not found.');

  const result = await db.query(
    `SELECT ${STUDENT_COLUMNS}
     FROM students
     WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  );
  if (result.rowCount === 0) throw ServiceError.notFound('Student not found.');

  const definitions = await loadDefinitions(db);
  return presentStudent(result.rows[0], definitions);
}

// Update a student. `changes` may contain fullName, identity fields, and/or extra.
// Student codes are immutable. extra keys sent as empty/null are cleared; the rest are merged.
export async function updateStudent(id, changes = {}) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Student not found.');

  if ('studentCode' in changes) {
    throw ServiceError.validation('Student codes cannot be changed.');
  }

  const hasName = 'fullName' in changes;
  const hasGender = 'gender' in changes;
  const hasBirthDate = 'birthDate' in changes;
  const hasFatherName = 'fatherName' in changes;
  const hasNationalId = 'nationalId' in changes;
  const hasExtra = 'extra' in changes;
  if (
    !hasName &&
    !hasGender &&
    !hasBirthDate &&
    !hasFatherName &&
    !hasNationalId &&
    !hasExtra
  ) {
    throw ServiceError.validation('Nothing to change.');
  }

  const sets = [];
  const values = [];

  if (hasName) {
    const parsed = normalizeFullName(changes.fullName);
    if (parsed.error) throw ServiceError.validation(parsed.error);
    values.push(parsed.value);
    sets.push(`full_name = $${values.length}`);
  }
  if (hasGender) {
    const parsed = normalizeGender(changes.gender);
    if (parsed.error) throw ServiceError.validation(parsed.error);
    values.push(parsed.value);
    sets.push(`gender = $${values.length}`);
  }
  if (hasBirthDate) {
    const parsed = normalizeBirthDate(changes.birthDate);
    if (parsed.error) throw ServiceError.validation(parsed.error);
    values.push(parsed.value);
    sets.push(`birth_date = $${values.length}`);
  }
  if (hasFatherName) {
    const parsed = normalizeFatherName(changes.fatherName);
    if (parsed.error) throw ServiceError.validation(parsed.error);
    values.push(parsed.value);
    sets.push(`father_name = $${values.length}`);
  }
  if (hasNationalId) {
    const parsed = normalizeNationalId(changes.nationalId);
    if (parsed.error) throw ServiceError.validation(parsed.error);
    values.push(parsed.value);
    sets.push(`national_id = $${values.length}`);
  }

  const definitions = await loadDefinitions(db);
  if (hasExtra) {
    const writableDefs = CAN_SEE_RESTRICTED
      ? definitions
      : definitions.filter((d) => !d.isRestricted);
    const extra = validateExtra(writableDefs, changes.extra);
    if (extra.error) throw ServiceError.validation(extra.error);
    const clearKeys = Object.keys(changes.extra).filter(
      (key) => !(key in extra.value),
    );
    values.push(JSON.stringify(extra.value));
    const mergeIndex = values.length;
    values.push(clearKeys);
    const clearIndex = values.length;
    sets.push(`extra = (extra || $${mergeIndex}::jsonb) - $${clearIndex}::text[]`);
  }

  values.push(id);
  let result;
  try {
    result = await db.query(
      `UPDATE students
       SET ${sets.join(', ')}
       WHERE id = $${values.length} AND deleted_at IS NULL
       RETURNING ${STUDENT_COLUMNS}`,
      values,
    );
  } catch (err) {
    if (err && err.code === '23505' && err.constraint === 'students_national_id_unique') {
      throw ServiceError.conflict('A student with that National ID already exists.');
    }
    throw err;
  }
  if (result.rowCount === 0) throw ServiceError.notFound('Student not found.');

  const actor = getLocalActor();
  await recordAudit(db, {
    userId: actor.userId,
    actor: actor.actor,
    action: 'student.update',
    entityType: 'student',
    entityId: id,
    details: { fullName: result.rows[0].fullName },
  });

  return presentStudent(result.rows[0], definitions);
}

// Soft-delete a student (sets deleted_at). Throws NOT_FOUND if already gone.
export async function deleteStudent(id) {
  const db = getDb();
  if (!isUuid(id)) throw ServiceError.notFound('Student not found.');

  const result = await db.query(
    `UPDATE students
     SET deleted_at = now()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING full_name AS "fullName", student_code AS "studentCode"`,
    [id],
  );
  if (result.rowCount === 0) throw ServiceError.notFound('Student not found.');

  const actor = getLocalActor();
  await recordAudit(db, {
    userId: actor.userId,
    actor: actor.actor,
    action: 'student.delete',
    entityType: 'student',
    entityId: id,
    details: result.rows[0],
  });
}

// Bulk-import students from parsed rows. `input` = { rows, allowDuplicateNames?,
// dryRun? }. A dry run classifies without writing; a real run inserts inside a
// transaction and records one audit entry. Returns { dryRun, counts, rows, ... }.
export async function importStudents(input) {
  const db = getDb();

  const parsed = validateImportBody(input);
  if (parsed.error) throw ServiceError.validation(parsed.error);
  const { rows, allowDuplicateNames, dryRun } = parsed;

  let classified = await classifyStoredImport(db, { rows, allowDuplicateNames });
  let counts = importCounts(classified);

  if (dryRun) {
    return { dryRun: true, rows: classified, counts };
  }
  if (counts.willImport === 0) {
    throw ServiceError.validation('There are no rows to import.');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT lock_academic_write()');

    const created = [];
    classified = await classifyStoredImport(client, { rows, allowDuplicateNames });
    counts = importCounts(classified);
    if (counts.willImport === 0) throw ServiceError.validation('There are no rows to import.');
    for (const item of classified) {
      if (!item.willImport) continue;

      const student = await insertWithUniqueCode(
        client,
        'student_code, full_name, gender, birth_date, father_name, national_id',
        '$1, $2, $3, $4, $5, $6',
        (code) => [code, item.fullName, item.gender, item.birthDate, item.fatherName, item.nationalId],
      );
      if (student === null) {
        throw ServiceError.conflict('Could not create a unique student code.');
      }
      created.push({ row: item.row, ...student });
    }

    const actor = getLocalActor();
    await recordAudit(client, {
      userId: actor.userId,
      actor: actor.actor,
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
    return { dryRun: false, created, rows: classified, counts };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
