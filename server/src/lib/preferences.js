import { isUuid } from './ids.js';
import { DEFAULT_REPORT_SCOPE, validReportScope } from './reportScope.js';

export const THEMES = ['system', 'light', 'dark'];
export const PALETTES = [
  'aurora',
  'gradebook',
  'midnight',
  'ember',
  'meadow',
  'cobalt',
  'crimson',
  'aurum',
  'aurum-glass',
];
export const PAGE_SIZES = [10, 25, 50, 100];
export const SORTS = ['newest', 'oldest', 'name', 'code'];
export const TABS = ['overview', 'period', 'parameter'];
export const CSV_DELIMITERS = [',', ';'];
const MAX_HIDDEN = 200;

export const LANGUAGES = ['fa', 'en'];

export const DEFAULT_PREFERENCES = {
  theme: 'dark',
  palette: 'aurora',
  language: 'fa',
  persianFont: 'vazirmatn',
  customCursor: true,
  studentsPageSize: 25,
  studentsSort: 'newest',
  studentsShowCode: true,
  studentsShowAdded: true,
  studentDefaultTab: 'overview',
  studentShowAllPeriods: false,
  hiddenParameterIds: [],
  csvDelimiter: ',',
  reportScope: DEFAULT_REPORT_SCOPE,
  dashboardConstellation: {
    dimension: 'quality',
    basis: 'value',
    assignmentId: null,
    seq: null,
    groupId: null,
    mode: 'auto',
    autoRotate: true,
    parameterIds: null,
  },
};

const CHECKS = {
  reportScope: validReportScope,
  theme: (value) => THEMES.includes(value),
  palette: (value) => PALETTES.includes(value),
  language: (value) => LANGUAGES.includes(value),
  persianFont: (value) => ['vazirmatn', 'estedad', 'shabnam', 'sahel'].includes(value),
  customCursor: (value) => typeof value === 'boolean',
  studentsPageSize: (value) => PAGE_SIZES.includes(value),
  studentsSort: (value) => SORTS.includes(value),
  studentsShowCode: (value) => typeof value === 'boolean',
  studentsShowAdded: (value) => typeof value === 'boolean',
  studentDefaultTab: (value) => TABS.includes(value),
  studentShowAllPeriods: (value) => typeof value === 'boolean',
  csvDelimiter: (value) => CSV_DELIMITERS.includes(value),
  hiddenParameterIds: (value) =>
    Array.isArray(value) &&
    value.length <= MAX_HIDDEN &&
    value.every(isUuid) &&
    new Set(value).size === value.length,
  // The dashboard hero/constellation customization: which assignment period
  // the class field shows, which dimension feeds it, and what counts as
  // answered. Kept as one object so the panel writes it in a single update.
  dashboardConstellation: (value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const dimension = value.dimension === undefined ? 'quality' : value.dimension;
    const basis = value.basis === undefined ? 'value' : value.basis;
    const assignmentOk =
      value.assignmentId === undefined ||
      value.assignmentId === null ||
      isUuid(value.assignmentId);
    const seqOk =
      value.seq === undefined ||
      value.seq === null ||
      (Number.isInteger(value.seq) && value.seq >= 1);
    const groupOk =
      value.groupId === undefined ||
      value.groupId === null ||
      isUuid(value.groupId);
    const mode = value.mode === undefined ? 'auto' : value.mode;
    const rotateOk = value.autoRotate === undefined || typeof value.autoRotate === 'boolean';
    const parametersOk = value.parameterIds == null || (
      Array.isArray(value.parameterIds) && value.parameterIds.length <= 200 &&
      value.parameterIds.every(isUuid) && new Set(value.parameterIds).size === value.parameterIds.length
    );
    return (
      assignmentOk &&
      seqOk &&
      groupOk &&
      rotateOk &&
      parametersOk &&
      ['auto', '3d', '2d'].includes(mode) &&
      (dimension === 'quality' || dimension === 'quantity') &&
      (basis === 'value' || basis === 'valueOrComment')
    );
  },
};

export function parsePreferencesUpdate(body) {
  const isObject =
    body !== null && typeof body === 'object' && !Array.isArray(body);
  if (!isObject) {
    return {
      error: 'Send an object with the settings to change.',
      code: 'VALIDATION_INVALID_TYPE',
    };
  }

  const values = {};
  for (const [key, value] of Object.entries(body)) {
    if (!Object.hasOwn(CHECKS, key)) {
      return {
        error: `Unknown setting: ${key}.`,
        code: 'VALIDATION_INVALID_CHOICE',
        params: { key },
      };
    }
    if (!CHECKS[key](value)) {
      return {
        error: `Invalid value for ${key}.`,
        code: 'VALIDATION_INVALID_CHOICE',
        params: { key },
      };
    }
    values[key] = value;
  }
  if (Object.keys(values).length === 0) {
    return {
      error: 'Nothing to change.',
      code: 'VALIDATION_NOTHING_TO_CHANGE',
    };
  }
  return { values };
}

export function mergePreferences(stored) {
  const result = {
    ...DEFAULT_PREFERENCES,
    hiddenParameterIds: [],
    dashboardConstellation: { ...DEFAULT_PREFERENCES.dashboardConstellation },
  };
  if (stored !== null && typeof stored === 'object') {
    for (const key of Object.keys(CHECKS)) {
      if (Object.hasOwn(stored, key) && CHECKS[key](stored[key])) {
        result[key] =
          key === 'dashboardConstellation'
            ? { ...DEFAULT_PREFERENCES.dashboardConstellation, ...stored[key] }
            : stored[key];
      }
    }
  }
  return result;
}
