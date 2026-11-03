// Dashboard aggregates over the schema-4 results grid: rows are the
// assignment's evaluation targets (the whole-group row + members), cells carry
// BOTH dimensions plus their answered state. Everything here is
// dimension-aware (quality | quantity) and, where it concerns completion,
// basis-aware: "value" counts only cells with a value, "valueOrComment" also
// counts a comment-only cell as answered. The whole-group row never counts
// toward the student roll-up — students live in their own rows.

function round(number) {
  return Math.round(number * 100) / 100;
}

function sum(numbers) {
  return numbers.reduce((total, value) => total + value, 0);
}

function normalize({ dimension = 'quality', basis = 'value' } = {}) {
  return {
    dimension: dimension === 'quantity' ? 'quantity' : 'quality',
    basis: basis === 'valueOrComment' ? 'valueOrComment' : 'value',
  };
}

function answered(cell, basis, dimension) {
  if (!cell) return false;
  const value = cell[dimension];
  if (basis === 'valueOrComment') {
    return value != null || cell[`${dimension}Comment`] != null;
  }
  return value != null;
}

// The parameters "in use" this period: those with at least one selected cell
// anywhere in the grid (selected-but-unanswered still counts as in use — the
// row is the expectation).
function inUseParameters(results) {
  return results.parameters.filter((parameter) =>
    results.rows.some((row) => row.cells[parameter.id] !== undefined)
  );
}

function forRow(parameters, row) {
  return parameters.filter(p => row.expectedParameterIds
    ? row.expectedParameterIds.includes(p.id) : row.cells[p.id] !== undefined);
}

// Keep an explicit saved choice when it still exists. Otherwise prefer the
// newest period that actually contains answers, so a generated future period
// does not make the dashboard/constellation look empty by default.
export function dashboardPeriodSeq(periods, requestedSeq) {
  if (periods.some((period) => period.seq === requestedSeq)) return requestedSeq;
  const populated = periods.filter((period) => (period.answeredCount ?? 0) > 0);
  return populated[populated.length - 1]?.seq ?? periods[periods.length - 1]?.seq ?? null;
}

export function summarize(results, options = {}) {
  const { dimension, basis } = normalize(options);
  const inUse = inUseParameters(results);
  const students = results.rows.filter((row) => !row.isGroup);
  const expected = students.reduce((total, row) => total + forRow(inUse, row).length, 0);
  let measured = 0;
  let complete = 0;
  let partial = 0;
  let none = 0;

  for (const row of students) {
    const applicable = forRow(inUse, row);
    const have = applicable.filter((parameter) =>
      answered(row.cells[parameter.id], basis, dimension)
    ).length;
    measured += have;
    if (applicable.length > 0 && have === applicable.length) complete++;
    else if (have > 0) partial++;
    else none++;
  }

  return {
    students: students.length,
    parametersInUse: inUse.length,
    expected,
    measured,
    completion: expected > 0 ? Math.round((measured * 100) / expected) : null,
    studentsComplete: complete,
    studentsPartial: partial,
    studentsNone: none,
  };
}

// One entry per student — the "living class field" on the dashboard hero.
// Roster order is preserved so a dot maps to a stable position across renders.
export function cohortField(results, options = {}) {
  const { dimension, basis } = normalize(options);
  const inUse = inUseParameters(results);
  return results.rows
    .filter((row) => !row.isGroup)
    .map((row) => {
      const applicable = forRow(inUse, row);
      const measured = applicable.filter((parameter) =>
        answered(row.cells[parameter.id], basis, dimension)
      ).length;
      let state;
      if (applicable.length > 0 && measured === applicable.length) state = 'full';
      else if (measured > 0) state = 'partial';
      else state = 'none';
      return {
        id: row.studentId,
        fullName: row.fullName,
        studentCode: row.studentCode,
        measured,
        inUse: applicable.length,
        state,
      };
    });
}

// Per-parameter stats over the student rows (the whole-group row is a
// class-level summary and would double-count). `inUse` drives the
// constellation's ring fan.
export function parameterStats(results, options = {}) {
  const { dimension, basis } = normalize(options);
  const students = results.rows.filter((row) => !row.isGroup);
  return results.parameters.map((parameter) => {
    const values = [];
    const changes = [];
    let selected = 0;
    let answeredCount = 0;
    for (const row of students) {
      const cell = row.cells[parameter.id];
      const now = cell?.[dimension];
      if (cell !== undefined) selected++;
      if (answered(cell, basis, dimension)) answeredCount++;
      if (now !== undefined && now !== null) values.push(now);
      const before = row.previous[parameter.id]?.[dimension];
      if (
        now !== null &&
        now !== undefined &&
        before !== null &&
        before !== undefined
      ) {
        changes.push(now - before);
      }
    }
    return {
      dimension,
      parameter: { ...parameter, inUse: selected > 0 },
      values,
      count: values.length,
      answeredCount,
      selected,
      average: values.length ? round(sum(values) / values.length) : null,
      min: values.length ? Math.min(...values) : null,
      max: values.length ? Math.max(...values) : null,
      paired: changes.length,
      averageChange: changes.length ? round(sum(changes) / changes.length) : null,
    };
  });
}

export function distribution(values, parameter, binCount = 5) {
  const hasRange =
    parameter.minValue !== null &&
    parameter.maxValue !== null &&
    parameter.maxValue > parameter.minValue;

  let lo;
  let hi;
  if (hasRange) {
    lo = parameter.minValue;
    hi = parameter.maxValue;
  } else if (values.length === 0) {
    return [];
  } else {
    lo = Math.min(...values);
    hi = Math.max(...values);
  }

  if (hi === lo) {
    return [{ from: lo, to: hi, label: String(round(lo)), count: values.length }];
  }

  const width = hi - lo;
  const bins = Array.from({ length: binCount }, (_, index) => {
    const from = round(lo + (index * width) / binCount);
    const to = round(lo + ((index + 1) * width) / binCount);
    return { from, to, label: `${from}–${to}`, count: 0 };
  });
  for (const value of values) {
    const index = Math.floor(((value - lo) * binCount) / width);
    bins[Math.min(binCount - 1, Math.max(0, index))].count++;
  }
  return bins;
}

// Trend lines are per (parameter, assignment, period) now. For one parameter
// the series walks the assignments in name order, each period its own point,
// labelled so the sequences stay distinguishable.
export function trendSeries({ trends, parameterId }) {
  return trends
    .filter((row) => row.parameterId === parameterId)
    .sort(
      (a, b) =>
        String(a.assignmentName).localeCompare(String(b.assignmentName)) ||
        a.periodSeq - b.periodSeq
    )
    .map((row) => ({
      label: `${row.assignmentName} · ${row.periodSeq}`,
      assignmentId: row.assignmentId,
      periodSeq: row.periodSeq,
      average: row.average,
      count: row.count,
      lastSessionDate: row.lastSessionDate,
    }));
}

// One student's card behind their node: every in-use parameter with the
// viewed dimension's value (null where nothing was answered) and the change
// from the previous period. The student's own cell wins over the whole-group
// row — that shadowing already happened server-side in the grid.
export function studentBreakdown(results, studentId, options = {}) {
  const { dimension, basis } = normalize(options);
  const inUse = inUseParameters(results);
  const row =
    results.rows.find((item) => item.studentId === studentId && !item.isGroup) ??
    null;
  const rows = (row ? forRow(inUse, row) : inUse).map((parameter) => {
    const cell = row?.cells[parameter.id];
    const value = cell?.[dimension] ?? null;
    const before = row?.previous[parameter.id]?.[dimension];
    return {
      parameter,
      value,
      answered: answered(cell, basis, dimension),
      change:
        value !== null && before !== null && before !== undefined
          ? round(value - before)
          : null,
    };
  });
  return {
    id: studentId,
    dimension,
    fullName: row?.fullName ?? '',
    studentCode: row?.studentCode ?? null,
    measured: rows.filter((entry) => entry.answered).length,
    inUse: rows.length,
    rows,
  };
}

// Who still owes answers: students with selected-but-unanswered (or entirely
// unselected) cells among the in-use parameters, worst first.
export function unmeasuredStudents(results, options = {}) {
  const { dimension, basis } = normalize(options);
  const inUse = inUseParameters(results);
  if (inUse.length === 0) return [];

  return results.rows
    .filter((row) => !row.isGroup)
    .map((row) => ({
      id: row.studentId,
      fullName: row.fullName,
      studentCode: row.studentCode,
      missing: forRow(inUse, row)
        .filter((parameter) => !answered(row.cells[parameter.id], basis, dimension))
        .map((parameter) => parameter.name),
    }))
    .filter((item) => item.missing.length > 0)
    .sort(
      (a, b) =>
        b.missing.length - a.missing.length ||
        a.fullName.localeCompare(b.fullName, undefined, { sensitivity: 'base' })
    );
}
