import { isUuid } from './ids.js';

export const MAX_ENTRIES = 5000;
export const MAX_COMMENT = 500;
const MAX_ABS_VALUE = 1_000_000_000;

// A comment is optional. Returns the cleaned comment (or null) — treat
// missing, null, or blank all as "no comment". `undefined` signals invalid.
export function normalizeComment(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') return undefined; // signals invalid
  const value = raw.trim();
  return value === '' ? null : value;
}

function checkDimensionValue(entry, field) {
  if (!(field in entry)) {
    return `Every entry needs ${field} (an integer or null).`;
  }
  const value = entry[field];
  if (value === null) return null;
  if (!Number.isInteger(value)) {
    return `${field} must be a whole number or null.`;
  }
  if (Math.abs(value) > MAX_ABS_VALUE) {
    return `${field} is outside the supported range.`;
  }
  return null;
}

function checkDimensionComment(entry, field) {
  if (!(field in entry)) return null;
  const comment = normalizeComment(entry[field]);
  if (comment === undefined) {
    return `${field} must be text or empty.`;
  }
  if (comment !== null && comment.length > MAX_COMMENT) {
    return `${field} is too long (the maximum is ${MAX_COMMENT} characters).`;
  }
  return null;
}

// Shape check only — no database. `selected` is the cell's existence: the row
// is the expectation, so an entry always carries it explicitly.
export function validateShape(entries, { patch = false } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'entries must be a non-empty list.';
  }
  if (entries.length > MAX_ENTRIES) {
    return `Too many entries (the maximum is ${MAX_ENTRIES}).`;
  }

  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') {
      return 'Every entry must be an object.';
    }
    if (entry.membershipId !== null && !isUuid(entry.membershipId)) {
      return 'Every entry needs a membershipId (an ID, or null for the whole group).';
    }
    if (!isUuid(entry.parameterId)) {
      return 'Every entry needs a valid parameterId.';
    }
    if (typeof entry.selected !== 'boolean') {
      return 'Every entry needs selected (true = keep the row, false = remove it).';
    }
    for (const field of ['qualityValue', 'quantityValue']) {
      if (patch && !Object.hasOwn(entry, field)) continue;
      const error = checkDimensionValue(entry, field);
      if (error) return error;
    }
    for (const field of ['qualityComment', 'quantityComment']) {
      const error = checkDimensionComment(entry, field);
      if (error) return error;
    }
  }
  return null;
}

// Semantic problems. `memberships` maps membershipId → student info for the
// assignment's valid targets (open memberships of its group, or its single
// member); `parameters` maps parameterId → { name, minValue, maxValue }.
// Applicability is the evaluator's explicit cell selection — there is no
// parameter-use log to check against — so any known parameter is fair game.
export function findProblems({ entries, parameters, memberships }) {
  const problems = [];
  const seen = new Set();

  entries.forEach((entry, index) => {
    function report(message) {
      problems.push({
        index,
        membershipId: entry.membershipId,
        parameterId: entry.parameterId,
        message,
      });
    }

    const key = `${entry.membershipId ?? 'group'}:${entry.parameterId}`;
    if (seen.has(key)) {
      report('This target and parameter appear more than once.');
      return;
    }
    seen.add(key);

    if (entry.membershipId !== null && !memberships.has(entry.membershipId)) {
      report('This target is not part of the assignment.');
      return;
    }

    const parameter = parameters.get(entry.parameterId);
    if (!parameter) {
      report('Parameter not found.');
      return;
    }

    for (const [field, value] of [
      ['qualityValue', entry.qualityValue],
      ['quantityValue', entry.quantityValue],
    ]) {
      if (value === null) continue;
      const min = field === 'qualityValue' ? 0 : parameter.minValue;
      const max = field === 'qualityValue' ? 100 : parameter.maxValue;
      if (min != null && value < min) {
        report(`${parameter.name} ${field} must be at least ${min}.`);
      } else if (max != null && value > max) {
        report(`${parameter.name} ${field} must be at most ${max}.`);
      }
    }
  });

  return problems;
}
