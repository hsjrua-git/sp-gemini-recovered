import { normalizeFullName, parseStudentIdentity } from '../validation/student.js';

export const MAX_IMPORT_ROWS = 500;

export function nameKey(name) {
  return name.normalize('NFC').toLowerCase();
}

export function validateImportBody(body) {
  const input =
    body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body
      : null;
  if (input === null) {
    return {
      error: 'Send an object with a list of rows.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }

  const { rows, allowDuplicateNames = false, dryRun = false } = input;
  if (typeof allowDuplicateNames !== 'boolean' || typeof dryRun !== 'boolean') {
    return {
      error: 'allowDuplicateNames and dryRun must be true or false.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return {
      error: 'rows must be a non-empty list.',
      code: 'VALIDATION_REQUIRED',
    };
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return {
      error: `Import at most ${MAX_IMPORT_ROWS} rows at a time.`,
      code: 'STUDENTS_IMPORT_TOO_MANY',
      params: { max: MAX_IMPORT_ROWS },
    };
  }

  const cleaned = [];
  const seenRows = new Set();
  for (const item of rows) {
    const valid =
      item !== null &&
      typeof item === 'object' &&
      Number.isInteger(item.row) &&
      item.row >= 1 &&
      item.row <= 1_000_000 &&
      typeof item.fullName === 'string';
    if (!valid) {
      return {
        error: 'Every row needs a row number and a fullName.',
        code: 'VALIDATION_REQUIRED',
      };
    }
    if (seenRows.has(item.row)) {
      return {
        error: 'Row numbers must be unique.',
        code: 'VALIDATION_NOT_UNIQUE',
      };
    }
    seenRows.add(item.row);
    cleaned.push({ row: item.row, fullName: item.fullName,
      gender: item.gender, birthDate: item.birthDate, fatherName: item.fatherName, nationalId: item.nationalId });
  }
  return { rows: cleaned, allowDuplicateNames, dryRun };
}

export function classifyImportRows({ rows, existing, existingNationalIds = new Set(), allowDuplicateNames }) {
  const firstSeen = new Map();
  const nationalIds = new Set(existingNationalIds);

  return rows.map(({ row, fullName, ...identity }) => {
    const parsed = normalizeFullName(fullName);
    const parsedIdentity = parseStudentIdentity(identity);
    const problem = parsed.error ? parsed : parsedIdentity.error ? parsedIdentity : null;
    if (problem) {
      return {
        row,
        fullName: fullName.trim(),
        status: 'invalid',
        message: problem.error,
        code: problem.code,
        existingCode: null,
        willImport: false,
      };
    }

    const name = parsed.value;
    if (nationalIds.has(parsedIdentity.values.nationalId)) {
      return { row, fullName: name, ...parsedIdentity.values, status: 'invalid',
        message: 'National ID already exists in the database or this file.', code: 'VALIDATION_NOT_UNIQUE',
        existingCode: null, willImport: false };
    }
    nationalIds.add(parsedIdentity.values.nationalId);
    const key = nameKey(name);
    let status = 'ok';
    let message = '';
    let existingCode = null;

    if (existing.has(key)) {
      status = 'duplicate_existing';
      existingCode = existing.get(key);
      message = 'A student with this name already exists.';
    } else if (firstSeen.has(key)) {
      status = 'duplicate_in_file';
      message = `Same name as row ${firstSeen.get(key)}.`;
    }
    if (!firstSeen.has(key)) firstSeen.set(key, row);

    return {
      row,
      fullName: name,
      ...parsedIdentity.values,
      status,
      message,
      existingCode,
      willImport: status === 'ok' || allowDuplicateNames,
    };
  });
}

export function importCounts(classified) {
  const counts = {
    total: classified.length,
    willImport: 0,
    invalid: 0,
    duplicates: 0,
    skipped: 0,
  };
  for (const item of classified) {
    if (item.status === 'invalid') counts.invalid++;
    if (item.status.startsWith('duplicate')) counts.duplicates++;
    if (item.willImport) counts.willImport++;
    else counts.skipped++;
  }
  return counts;
}

export async function classifyStoredImport(db, input) {
  const stored = await db.query(
    `SELECT full_name AS "fullName", student_code AS "studentCode", national_id AS "nationalId"
     FROM students`,
  );
  const existing = new Map();
  for (const student of stored.rows) {
    const key = nameKey(student.fullName);
    if (!existing.has(key)) existing.set(key, student.studentCode);
  }
  return classifyImportRows({ ...input, existing,
    existingNationalIds: new Set(stored.rows.map(student => student.nationalId)) });
}
