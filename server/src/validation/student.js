import { isValidIsoDate, todayIso } from '../lib/periods.js';

export function normalizeFullName(input) {
  if (typeof input !== 'string') {
    return { error: 'Full name is required.', code: 'VALIDATION_REQUIRED' };
  }
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return {
      error: 'Full name must be at least 2 characters.',
      code: 'VALIDATION_TOO_SHORT',
      params: { min: 2 },
    };
  }
  if (name.length > 100) {
    return {
      error: 'Full name must be 100 characters or fewer.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 100 },
    };
  }
  return { value: name };
}

// Identity is required for every student, including edits and CSV imports.
const required = (field) => ({ error: `${field} is required.`, code: 'VALIDATION_REQUIRED' });

export function normalizeGender(input) {
  if (input === undefined || input === null || input === '') return required('Gender');
  if (input === 'male' || input === 'female') return { value: input };
  return {
    error: 'Gender must be "male" or "female".',
    code: 'VALIDATION_INVALID_CHOICE',
  };
}

export function normalizeBirthDate(input) {
  if (input === undefined || input === null || input === '') return required('Birth date');
  if (typeof input !== 'string' || !isValidIsoDate(input)) {
    return {
      error: 'Birth date must be a valid date (YYYY-MM-DD).',
      code: 'VALIDATION_INVALID_DATE',
    };
  }
  if (input > todayIso()) {
    return {
      error: 'Birth date cannot be in the future.',
      code: 'VALIDATION_DATE_IN_FUTURE',
    };
  }
  return { value: input };
}

export function normalizeFatherName(input) {
  if (input === undefined || input === null || input === '') return required('Father name');
  if (typeof input !== 'string') {
    return {
      error: 'Father name must be text.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length < 2) {
    return {
      error: 'Father name must be at least 2 characters.',
      code: 'VALIDATION_TOO_SHORT',
      params: { min: 2 },
    };
  }
  if (name.length > 100) {
    return {
      error: 'Father name must be 100 characters or fewer.',
      code: 'VALIDATION_TOO_LONG',
      params: { max: 100 },
    };
  }
  return { value: name };
}

export function normalizeNationalId(input) {
  if (input === undefined || input === null || input === '') return required('National ID');
  if (typeof input !== 'string' || !/^[0-9]{10}$/.test(input)) {
    return {
      error: 'National ID must be exactly 10 digits.',
      code: 'VALIDATION_INVALID_FORMAT',
      params: { length: 10 },
    };
  }
  return { value: input };
}

export function parseStudentIdentity(input = {}) {
  const values = {};
  for (const [field, normalize] of Object.entries({
    gender: normalizeGender, birthDate: normalizeBirthDate,
    fatherName: normalizeFatherName, nationalId: normalizeNationalId,
  })) {
    const parsed = normalize(input[field]);
    if (parsed.error) return parsed;
    values[field] = parsed.value;
  }
  return { values };
}
