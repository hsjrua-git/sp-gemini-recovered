import { toLatinDigits } from './locale.js';

export const IDENTITY_COLUMNS = ['gender', 'birthDate', 'fatherName', 'nationalId'];
const headers = {
  gender: /^(gender|sex|جنسیت)$/i,
  birthDate: /^(birth\s*date|date\s*of\s*birth|dob|تاریخ\s*تولد)$/i,
  fatherName: /^(father['’]?s?\s*name|نام\s*پدر)$/i,
  nationalId: /^(national\s*(id|code)|کد\s*ملی)$/i,
};

export function guessIdentityColumns(cells = []) {
  return Object.fromEntries(IDENTITY_COLUMNS.map(field => [field,
    cells.findIndex(cell => headers[field].test(String(cell).replace(/[_-]/g, ' ').trim())),
  ]));
}

export function includeStudentIdentity(names, rows, columns) {
  const byRow = new Map(rows.map(row => [row.row, row.cells]));
  return names.map(name => {
    const cells = byRow.get(name.row) ?? [];
    const identity = Object.fromEntries(IDENTITY_COLUMNS.map(field =>
      [field, toLatinDigits(String(cells[columns[field]] ?? '').trim())]));
    if (/^(male|m|مرد|پسر)$/i.test(identity.gender)) identity.gender = 'male';
    if (/^(female|f|زن|دختر)$/i.test(identity.gender)) identity.gender = 'female';
    return { ...name, ...identity };
  });
}
