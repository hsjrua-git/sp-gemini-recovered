// Score-import parsing under the schema-4 model: a CSV is scoped to ONE
// session, and each parameter spans up to TWO columns — quality and quantity
// ("Name (quality)" / "Name (quantity)"; a bare "Name" maps to quality).
// Rows resolve to students by code, and each student must be a target of the
// session's assignment (their membership id keys the saved cell).
import { parseDimension } from './cells.js';

const CODE_HEADER = /^(student[\s_-]*)?(code|id)$/i;
const NAME_HEADER = /^(full[\s_-]*name|name|student(\s*name)?)$/i;
const DIM_SUFFIX = /\s*\((quality|کیفیت|quantity|کمیت)\)\s*$/i;

export const MAX_SCORE_CELLS = 5000;

export function normalizeCode(text) {
  return String(text ?? '').replace(/[-\s]/g, '').toUpperCase();
}

export function nameKey(text) {
  return String(text ?? '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function reasonValid(text) {
  const value = String(text ?? '').trim().replace(/\s+/g, ' ');
  return value.length >= 5 && value.length <= 300;
}

export function looksLikeScoreHeader(cells, parameters) {
  const names = new Set(parameters.map((parameter) => nameKey(parameter.name)));
  return cells.some((cell) => {
    const text = String(cell ?? '').trim();
    return (
      CODE_HEADER.test(text) ||
      NAME_HEADER.test(text) ||
      names.has(nameKey(text.replace(DIM_SUFFIX, '')))
    );
  });
}

function dimensionOfSuffix(suffix) {
  return /quantity|کمیت/i.test(suffix) ? 'quantity' : 'quality';
}

export function guessLayout(headerCells, parameters) {
  const texts = headerCells.map((cell) => String(cell ?? '').trim());
  const codeColumn = texts.findIndex((text) => CODE_HEADER.test(text));
  const nameColumn = texts.findIndex((text) => NAME_HEADER.test(text));

  // Parameter columns pair up per parameter: a bare name or an explicit
  // "(quality)" maps to quality, "(quantity)" to quantity.
  const mapping = {};
  const taken = new Set();
  for (const parameter of parameters) {
    const wanted = nameKey(parameter.name);
    const columns = { qualityColumn: null, quantityColumn: null };
    texts.forEach((text, index) => {
      if (taken.has(index)) return;
      const stem = nameKey(text.replace(DIM_SUFFIX, ''));
      if (stem !== wanted) return;
      const match = text.match(DIM_SUFFIX);
      const dimension = match ? dimensionOfSuffix(match[1]) : 'quality';
      if (columns[`${dimension}Column`] === null) {
        columns[`${dimension}Column`] = index;
        taken.add(index);
      }
    });
    if (columns.qualityColumn !== null || columns.quantityColumn !== null) {
      mapping[parameter.id] = columns;
    }
  }

  return {
    codeColumn: codeColumn === -1 ? null : codeColumn,
    nameColumn: nameColumn === -1 ? null : nameColumn,
    mapping,
  };
}

// One file column's parsed state for the review table.
// `entryIndex` links a valid cell to its position in `entries`.
export function buildImport({
  rows,
  hasHeader,
  codeColumn,
  nameColumn,
  mapping,
  parameters,
  studentsByCode,
}) {
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const mapped = parameters.filter((parameter) => mapping[parameter.id]);

  const seenCodes = new Map();
  const entries = [];
  const refs = [];
  const viewRows = [];
  let localProblemCount = 0;
  let blankCells = 0;

  for (const { row, cells } of dataRows) {
    const rawCode = String(cells[codeColumn] ?? '').trim();
    const code = normalizeCode(rawCode);
    const student = code ? (studentsByCode.get(code) ?? null) : null;

    let rowProblem = null;
    if (!code) {
      rowProblem = 'No student code in this row.';
    } else if (!student) {
      rowProblem = `No student with code "${rawCode}".`;
    } else if (student.membershipId == null) {
      rowProblem = `${student.fullName} is not part of this session's assignment.`;
    } else if (seenCodes.has(code)) {
      rowProblem = `Same student as row ${seenCodes.get(code)}.`;
    } else {
      seenCodes.set(code, row);
      if (nameColumn !== null) {
        const fileName = String(cells[nameColumn] ?? '').trim();
        if (fileName !== '' && nameKey(fileName) !== nameKey(student.fullName)) {
          rowProblem = `The name in the file ("${fileName}") does not match ${student.fullName}.`;
        }
      }
    }
    if (rowProblem) localProblemCount++;

    // One flat cell per mapped DIMENSION column, in parameter then dimension
    // order; both dimensions of a parameter share the row's single entry.
    const viewCells = [];
    for (const parameter of mapped) {
      const { qualityColumn, quantityColumn } = mapping[parameter.id];
      const dimensions = [
        ['quality', qualityColumn],
        ['quantity', quantityColumn],
      ].filter(([, column]) => column !== null);

      if (dimensions.length === 0) continue;
      const texts = {};
      for (const [dimension, column] of dimensions) {
        texts[dimension] = String(cells[column] ?? '').trim();
      }
      const hasAny = Object.values(texts).some((text) => text !== '');
      for (const [dimension] of dimensions) {
        if (texts[dimension] === '') blankCells++;
      }

      const parsed = {};
      let cellProblem = null;
      if (!hasAny) {
        // entirely blank pair — nothing to import
      } else if (rowProblem) {
        cellProblem = rowProblem;
      } else {
        for (const [dimension] of dimensions) {
          if (texts[dimension] === '') continue;
          const result = parseDimension(texts[dimension], parameter, dimension);
          if (result.error) {
            cellProblem = `${dimension === 'quality' ? 'Quality' : 'Quantity'}: ${result.error}`;
          } else {
            parsed[dimension] = result.value;
          }
        }
      }

      // A row problem was already counted above; a parse problem counts once.
      if (cellProblem && !rowProblem) localProblemCount++;

      const entryIndex =
        !hasAny || cellProblem ? null : entries.length;
      if (entryIndex !== null) {
        entries.push({
          membershipId: student.membershipId,
          parameterId: parameter.id,
          selected: true,
           ...('quality' in parsed ? { qualityValue: parsed.quality } : {}),
           ...('quantity' in parsed ? { quantityValue: parsed.quantity } : {}),
        });
        refs.push({ row, parameterId: parameter.id });
      }

      for (const [dimension, column] of dimensions) {
        const text = texts[dimension];
        viewCells.push({
          parameterId: parameter.id,
          dimension,
          column,
          text,
          blank: text === '',
          problem: cellProblem,
          entryIndex,
        });
      }
    }

    viewRows.push({ row, rawCode, student, rowProblem, cells: viewCells });
  }

  return {
    rows: viewRows,
    entries,
    refs,
    localProblemCount,
    blankCells,
    mappedParameters: mapped,
  };
}

// Reconcile the local entries with the server's dry-run preview: skip rows the
// server flagged, count no-ops as unchanged, and route locked cells to the
// override path (blocked outright without the permission).
export function planImport({ built, server, canOverride }) {
  const problemIndexes = new Set(server.problems.map((problem) => problem.index));
  const statusByIndex = new Map(
    server.cells.map((cell) => [cell.index, cell.status])
  );

  const send = [];
  let unchanged = 0;
  let lockedOverride = 0;
  let lockedBlocked = 0;

  built.entries.forEach((entry, index) => {
    if (problemIndexes.has(index)) return;
    const status = statusByIndex.get(index);
    if (status === undefined) return;

    if (status === 'unchanged') {
      unchanged++;
      return;
    }
    if (status === 'locked') {
      if (!canOverride) {
        lockedBlocked++;
        return;
      }
      lockedOverride++;
    }
    send.push(entry);
  });

  return {
    send,
    unchanged,
    lockedOverride,
    lockedBlocked,
    problemCount: built.localProblemCount + problemIndexes.size + lockedBlocked,
  };
}
