import { Fragment, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { saveEvaluations } from '../api/evaluations.js';
import { listGroupMembers } from '../api/groups.js';
import { listParameters } from '../api/parameters.js';
import { fetchAllStudents } from '../api/students.js';
import { listAssignments } from '../api/schedule.js';
import { listSessions } from '../api/sessions.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import EmptyState from '../components/EmptyState.jsx';
import ExportButton from '../components/ExportButton.jsx';
import ImportSteps from '../components/ImportSteps.jsx';
import { LockIcon, UploadIcon } from '../components/icons.jsx';
import { scoreTemplateCsvRows } from '../lib/exports.js';
import { formatIsoDate, formatStudentCode, toIsoDate } from '../lib/format.js';
import { prepareRows } from '../lib/importNames.js';
import {
  MAX_SCORE_CELLS,
  buildImport,
  guessLayout,
  looksLikeScoreHeader,
  normalizeCode,
  planImport,
  reasonValid,
} from '../lib/scoreImport.js';

const EMPTY = [];
const MAX_FILE_BYTES = 2_000_000;

// How many file columns a mapped parameter occupies (its quality and/or
// quantity column) — the review table shows one sub-column per dimension.
function dimensionCount(columns) {
  if (!columns) return 0;
  return (
    (columns.qualityColumn !== null ? 1 : 0) +
    (columns.quantityColumn !== null ? 1 : 0)
  );
}

function columnLabel(t, index, headerCells) {
  const header = headerCells ? String(headerCells[index] ?? '').trim() : '';
  return header
    ? t('imports.columnWithHeader', { index: index + 1, header })
    : t('imports.columnN', { index: index + 1 });
}

function CellView({ cell, info, canOverride }) {
  const { t } = useTranslation(['students', 'common']);
  if (cell.blank) {
    return (
      <div className="muted" title={t('imports.scores.cellEmptyTitle')}>
        —
      </div>
    );
  }
  if (cell.problem) {
    return (
      <div className="error">
        {cell.text}
        <div className="small">{cell.problem}</div>
      </div>
    );
  }
  if (!info) return <div className="muted">{cell.text}</div>;
  const valueKey = cell.dimension === 'quantity' ? 'quantityValue' : 'qualityValue';
  const from = info.from?.[valueKey] ?? '—';
  const to = info.to?.[valueKey] ?? '—';

  if (info.status === 'problem') {
    return (
      <div className="error">
        {cell.text}
        <div className="small">{info.message}</div>
      </div>
    );
  }
  if (info.status === 'unchanged') {
    return <div className="muted">{t('imports.scores.cellSame', { value: to })}</div>;
  }
  if (info.status === 'new') {
    return (
      <div>
        <strong>{to}</strong>{' '}
        <span className="chg">{t('imports.scores.cellNew')}</span>
      </div>
    );
  }
  if (info.status === 'change') {
    return (
      <div>
        {from} → <strong>{to}</strong>
      </div>
    );
  }
  // Blind-entry role: the server redacts the existing value, so we can only
  // show what is about to be written, not a before → after diff.
  if (info.status === 'save') {
    return (
      <div>
        <strong>{to}</strong>{' '}
        <span className="chg">{t('imports.scores.cellSave')}</span>
      </div>
    );
  }
  return (
    <div className={canOverride ? undefined : 'error'}>
      <span className="lock" aria-hidden="true">
        <LockIcon />
      </span>{' '}
      {from} → <strong>{to}</strong>
      <div className="small">
        {canOverride
          ? t('imports.scores.cellLockedReason')
          : t('imports.scores.cellLockedAdmin')}
      </div>
    </div>
  );
}

function ColumnOptions({ columnCount, headerCells }) {
  const { t } = useTranslation(['students', 'common']);
  return Array.from({ length: columnCount }, (_, index) => (
    <option key={index} value={index}>
      {columnLabel(t, index, headerCells)}
    </option>
  ));
}

function ImportScoresPage() {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [assignmentId, setAssignmentId] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [codeChoice, setCodeChoice] = useState(null);
  const [nameChoice, setNameChoice] = useState(undefined);
  const [qualityChoice, setQualityChoice] = useState({});
  const [quantityChoice, setQuantityChoice] = useState({});
  const [skipProblems, setSkipProblems] = useState(false);
  const [reason, setReason] = useState('');
  const [stage, setStage] = useState('choose');
  const [preview, setPreview] = useState(null);
  const [done, setDone] = useState(null);

  const check = useMutation({ mutationFn: saveEvaluations });
  const run = useMutation({ mutationFn: saveEvaluations });

  const parametersQuery = useQuery({
    queryKey: ['parameters'],
    queryFn: listParameters,
  });
  const parameters = useMemo(
    () => (parametersQuery.data ?? EMPTY).filter((p) => !p.archivedAt),
    [parametersQuery.data]
  );

  const studentsQuery = useQuery({
    queryKey: ['students-all'],
    queryFn: fetchAllStudents,
    enabled: can('scores.enter'),
  });

  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
  });
  const assignments = assignmentsQuery.data ?? EMPTY;

  // Default assignment: the first one. Derived (not an effect) so the picker
  // falls back to it whenever the user has not explicitly chosen.
  const effectiveAssignmentId = assignmentId ?? assignments[0]?.id ?? null;
  const assignment =
    assignments.find((item) => item.id === effectiveAssignmentId) ?? null;

  const sessionsQuery = useQuery({
    queryKey: ['sessions', { assignmentId: effectiveAssignmentId }],
    queryFn: () =>
      listSessions({ assignmentId: effectiveAssignmentId, includeCanceled: true }),
    enabled: effectiveAssignmentId !== null,
  });
  const sessionsRaw = sessionsQuery.data?.sessions;
  const sessions = useMemo(() => sessionsRaw ?? EMPTY, [sessionsRaw]);

  // Default session: the first session of today or later, else the last usable
  // one. Derived (not an effect), like the assignment default above.
  const defaultSessionId = useMemo(() => {
    const usable = sessions.filter((session) => !session.canceledAt);
    if (usable.length === 0) return null;
    const today = toIsoDate(new Date());
    return (
      usable.find((session) => session.sessionDate >= today) ??
      usable[usable.length - 1]
    ).id;
  }, [sessions]);
  const effectiveSessionId = sessionId ?? defaultSessionId;
  const chosenSession =
    sessions.find((item) => item.id === effectiveSessionId) ?? null;

  const membersQuery = useQuery({
    queryKey: ['group-members', assignment?.groupId],
    queryFn: () => listGroupMembers(assignment.groupId),
    enabled: assignment?.groupId != null,
  });

  // Only the session's own assignment targets are resolvable: a code that is
  // not one of them gets the lib's "not part of this session's assignment"
  // row problem. A group assignment uses its open members; an individual
  // assignment is exactly its one member (its code comes from the students
  // list, which the template needs anyway).
  const targets = useMemo(() => {
    if (!assignment) return EMPTY;
    if (assignment.groupId) {
      return (membersQuery.data ?? EMPTY)
        .filter(
          (member) =>
            chosenSession?.sessionDate &&
            member.joinedOn <= chosenSession.sessionDate &&
            (!member.leftOn || member.leftOn >= chosenSession.sessionDate)
        )
        .map((member) => ({
          id: member.id,
          membershipId: member.membershipId,
          fullName: member.fullName,
          studentCode: member.studentCode,
        }));
    }
    const student = (studentsQuery.data ?? EMPTY).find(
      (item) => item.id === assignment.studentId
    );
    if (!student) return EMPTY;
    return [
      {
        id: student.id,
        membershipId: assignment.membershipId,
        fullName: assignment.studentName ?? student.fullName,
        studentCode: student.studentCode,
      },
    ];
  }, [assignment, chosenSession, membersQuery.data, studentsQuery.data]);

  const studentsByCode = useMemo(
    () =>
      new Map(
        targets
          .filter((target) => target.studentCode)
          .map((target) => [normalizeCode(target.studentCode), target])
      ),
    [targets]
  );

  const guess = useMemo(
    () =>
      hasHeader && rows.length > 0
        ? guessLayout(rows[0].cells, parameters)
        : { codeColumn: null, nameColumn: null, mapping: {} },
    [hasHeader, rows, parameters]
  );
  const codeColumn = codeChoice ?? guess.codeColumn ?? 0;
  const nameColumn = nameChoice === undefined ? guess.nameColumn : nameChoice;

  // Per parameter, the user's explicit choice (else the guessed column)
  // decides which file column feeds each dimension; null = not in the file.
  const mapping = useMemo(() => {
    const result = {};
    for (const parameter of parameters) {
      const guessed = guess.mapping[parameter.id];
      const qualityColumn =
        parameter.id in qualityChoice
          ? qualityChoice[parameter.id]
          : guessed?.qualityColumn ?? null;
      const quantityColumn =
        parameter.id in quantityChoice
          ? quantityChoice[parameter.id]
          : guessed?.quantityColumn ?? null;
      if (qualityColumn !== null || quantityColumn !== null) {
        result[parameter.id] = { qualityColumn, quantityColumn };
      }
    }
    return result;
  }, [parameters, guess, qualityChoice, quantityChoice]);

  // The targets must be resolved before rows can be matched against them.
  const targetsReady = assignment
    ? assignment.groupId
      ? membersQuery.isSuccess
      : studentsQuery.isSuccess
    : false;

  const built = useMemo(() => {
    if (rows.length === 0 || !targetsReady || effectiveSessionId === null) {
      return null;
    }
    return buildImport({
      rows,
      hasHeader,
      codeColumn,
      nameColumn,
      mapping,
      parameters,
      studentsByCode,
    });
  }, [
    rows,
    targetsReady,
    effectiveSessionId,
    hasHeader,
    codeColumn,
    nameColumn,
    mapping,
    parameters,
    studentsByCode,
  ]);

  const serverByIndex = useMemo(() => {
    const map = new Map();
    if (preview) {
      for (const cell of preview.server.cells) map.set(cell.index, cell);
      for (const problem of preview.server.problems) {
        map.set(problem.index, { status: 'problem', message: problem.message });
      }
    }
    return map;
  }, [preview]);

  function resetFile() {
    setFileName('');
    setRows([]);
    setParseError(null);
    setHasHeader(true);
    setCodeChoice(null);
    setNameChoice(undefined);
    setQualityChoice({});
    setQuantityChoice({});
    setSkipProblems(false);
    setReason('');
    setStage('choose');
    setPreview(null);
    setDone(null);
    check.reset();
    run.reset();
  }

  function handleSwitchAssignment(nextId) {
    if (nextId === effectiveAssignmentId) return;
    setAssignmentId(nextId);
    // A null session id lets the derived default pick one once the new
    // assignment's sessions arrive.
    setSessionId(null);
  }

  async function handleFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    resetFile();
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setParseError(t('imports.fileTooLarge', { size: '2 MB' }));
      input.value = '';
      return;
    }

    const text = (await file.text()).replace(/^\uFEFF/, '');
    const prepared = prepareRows(Papa.parse(text, { skipEmptyLines: false }).data);
    input.value = '';
    if (prepared.length === 0) {
      setParseError(t('imports.noRows'));
      return;
    }
    setRows(prepared);
    setHasHeader(looksLikeScoreHeader(prepared[0].cells, parameters));
  }

  function handleCheck() {
    check.mutate(
      { sessionId: effectiveSessionId, entries: built.entries, dryRun: true },
      {
        onSuccess: (server) => {
          setPreview({ built, server, mapping });
          setStage('preview');
        },
      }
    );
  }

  function backToSettings() {
    setStage('choose');
    check.reset();
    run.reset();
  }

  const canOverride = can('scores.override');
  const plan = preview
    ? planImport({ built: preview.built, server: preview.server, canOverride })
    : null;
  const needsReason = plan !== null && plan.lockedOverride > 0;
  const canRun =
    plan !== null &&
    plan.send.length > 0 &&
    (plan.problemCount === 0 || skipProblems) &&
    (!needsReason || reasonValid(reason)) &&
    !run.isPending;

  function handleImport() {
    run.mutate(
      {
        sessionId: effectiveSessionId,
        entries: plan.send,
        source: 'import',
        overrideReason: needsReason
          ? reason.trim().replace(/\s+/g, ' ')
          : undefined,
      },
      {
        onSuccess: (data) => {
          setDone({
            changed: data.changed,
            unchanged: plan.unchanged,
            skipped: plan.problemCount,
          });
          setStage('done');
          queryClient.invalidateQueries({ queryKey: ['evaluations'] });
          queryClient.invalidateQueries({ queryKey: ['academic-recovery'] });
          queryClient.invalidateQueries({ queryKey: ['export-cube'] });
          queryClient.invalidateQueries({ queryKey: ['results'] });
          queryClient.invalidateQueries({ queryKey: ['trends'] });
          queryClient.invalidateQueries({ queryKey: ['dashboard'] });
          queryClient.invalidateQueries({ queryKey: ['sessions'] });
          queryClient.invalidateQueries({ queryKey: ['periods'] });
        },
      }
    );
  }

  if (!can('scores.enter')) {
    return (
      <main>
        <EmptyState
          title={t('shared.readOnlyTitle')}
          description={t('imports.scores.readOnlyDescription')}
        />
      </main>
    );
  }
  if (assignmentsQuery.isPending) {
    return (
      <main aria-busy="true">
        <div className="page-loading" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <p>{t('common:status.loading')}</p>
        </div>
      </main>
    );
  }
  if (assignmentsQuery.isError) {
    return (
      <main>
        <EmptyState
          tone="danger"
          title={t('imports.scores.loadErrorTitle')}
          description={errorMessage(assignmentsQuery.error)}
        />
      </main>
    );
  }
  if (assignments.length === 0) {
    return (
      <main>
        <p>
          <Link to="/evaluate">{t('imports.scores.back')}</Link>
        </p>
        <h1>{t('imports.scores.title')}</h1>
        <EmptyState
          title={t('imports.scores.noAssignments')}
          description={t('imports.scores.noAssignmentsHint')}
        >
          <p>
            <Link to="/schedule">{t('imports.scores.goToSchedule')}</Link>
          </p>
        </EmptyState>
      </main>
    );
  }

  const columnCount = rows.reduce(
    (max, item) => Math.max(max, item.cells.length),
    0
  );
  const headerCells = hasHeader && rows.length > 0 ? rows[0].cells : null;

  const usedColumns = new Set([
    codeColumn,
    ...(nameColumn === null ? [] : [nameColumn]),
    ...Object.values(mapping).flatMap((columns) =>
      [columns.qualityColumn, columns.quantityColumn].filter(Number.isInteger)
    ),
  ]);
  const ignoredHeaders = headerCells
    ? headerCells
        .map((cell, index) => ({ index, text: String(cell ?? '').trim() }))
        .filter(({ index, text }) => text !== '' && !usedColumns.has(index))
        .map(({ text }) => text)
    : [];

  const tooMany = built !== null && built.entries.length > MAX_SCORE_CELLS;
  const server = preview?.server;
  const totalDimensions =
    preview === null
      ? 0
      : preview.built.mappedParameters.reduce(
          (sum, parameter) =>
            sum + dimensionCount(preview.mapping[parameter.id]),
          0
        );

  return (
    <main className="wide">
      <p>
        <Link to="/evaluate">{t('imports.scores.back')}</Link>
      </p>
      <h1>{t('imports.scores.title')}</h1>
      <ImportSteps
        steps={[
          t('imports.stepChoose'),
          t('imports.stepReview'),
          t('common:actions.done'),
        ]}
        current={stage === 'choose' ? 0 : stage === 'preview' ? 1 : 2}
      />

      {stage === 'choose' && (
        <>
          <p className="hint">{t('imports.scores.hint')}</p>

          <div className="control-bar">
            <label className="field">
              <span>{t('imports.scores.assignmentLabel')}</span>
              <select
                value={effectiveAssignmentId ?? ''}
                onChange={(event) =>
                  handleSwitchAssignment(event.target.value || null)
                }
              >
                {assignments.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name ?? item.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{t('imports.scores.sessionLabel')}</span>
              <select
                value={effectiveSessionId ?? ''}
                onChange={(event) => setSessionId(event.target.value || null)}
                disabled={sessions.length === 0}
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {formatIsoDate(session.sessionDate)}
                    {' · '}
                     {t('imports.scores.periodShort', {
                       seq: session.periodSeq ?? '…',
                     })}
                    {session.canceledAt ? t('imports.scores.canceledTag') : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {(sessionsQuery.error ?? membersQuery.error ?? parametersQuery.error) && (
            <p className="error" role="alert">
              {errorMessage(
                sessionsQuery.error ??
                  membersQuery.error ??
                  parametersQuery.error
              )}
            </p>
          )}

          {sessionsQuery.isSuccess && sessions.length === 0 && (
            <EmptyState
              title={t('imports.scores.noSessions')}
              description={t('imports.scores.noSessionsDescription')}
            >
              <p>
                <Link to="/schedule">{t('imports.scores.goToSchedule')}</Link>
              </p>
            </EmptyState>
          )}

          {sessions.length > 0 && (
            <>
              <p>
                <ExportButton
                  label={t('imports.scores.templateLabel')}
                  filename={`score-template-${
                    chosenSession?.sessionDate ?? 'session'
                  }.csv`}
                  disabled={parameters.length === 0}
                  buildRows={async () =>
                    scoreTemplateCsvRows({
                      students: await fetchAllStudents(),
                      parameters,
                    })
                  }
                />
              </p>
              {parametersQuery.isSuccess && parameters.length === 0 && (
                <p className="error">{t('imports.scores.noParams')}</p>
              )}

              <div className="drop-zone">
                <span className="drop-zone-mark">
                  <UploadIcon />
                </span>
                <input
                  type="file"
                  accept=".csv,.txt,text/csv"
                  aria-label={t('imports.scores.fileAria')}
                  onChange={handleFile}
                />
              </div>
              {parseError && (
                <p className="error" role="alert">
                  {parseError}
                </p>
              )}
              {rows.length > 0 && !targetsReady && (
                <p className="hint">{t('list.loading')}</p>
              )}
              {studentsQuery.isError && (
                <p className="error" role="alert">
                  {errorMessage(studentsQuery.error)}
                </p>
              )}

              {rows.length > 0 && (
                <section className="section-card">
                  <h2>{fileName}</h2>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('imports.row')}</th>
                          {Array.from({ length: columnCount }, (_, index) => (
                            <th key={index}>{columnLabel(t, index, null)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.slice(0, 5).map((item) => (
                          <tr key={item.row}>
                            <td>{item.row}</td>
                            {Array.from({ length: columnCount }, (_, index) => (
                              <td key={index}>{item.cells[index] ?? ''}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {rows.length > 5 && (
                    <p className="hint">
                      {t('imports.showingFirst', { count: rows.length })}
                    </p>
                  )}

                  <div className="pref-group">
                    <label className="inline">
                      <input
                        type="checkbox"
                        checked={hasHeader}
                        onChange={(event) =>
                          setHasHeader(event.target.checked)
                        }
                      />
                      {t('imports.firstRowHeader')}
                    </label>
                    <label className="inline">
                      {t('imports.scores.codeIn')}
                      <select
                        value={codeColumn}
                        onChange={(event) =>
                          setCodeChoice(Number(event.target.value))
                        }
                      >
                        <ColumnOptions
                          columnCount={columnCount}
                          headerCells={headerCells}
                        />
                      </select>
                    </label>
                    <label className="inline">
                      {t('imports.scores.nameCheck')}
                      <select
                        value={nameColumn ?? ''}
                        onChange={(event) =>
                          setNameChoice(
                            event.target.value === ''
                              ? null
                              : Number(event.target.value)
                          )
                        }
                      >
                        <option value="">{t('imports.scores.noNameColumn')}</option>
                        <ColumnOptions
                          columnCount={columnCount}
                          headerCells={headerCells}
                        />
                      </select>
                    </label>
                  </div>

                  <h3>{t('imports.scores.whichColumns')}</h3>
                  {!hasHeader && (
                    <p className="hint">{t('imports.scores.noHeaderHint')}</p>
                  )}
                  <div className="pref-group">
                    {parameters.map((parameter) => {
                      const columns =
                        mapping[parameter.id] ?? {
                          qualityColumn: null,
                          quantityColumn: null,
                        };
                      return (
                        <div key={parameter.id} className="row">
                          <strong>{parameter.path || parameter.name}</strong>
                          <label className="inline">
                            {t('imports.scores.qualityCol')}
                            <select
                              value={columns.qualityColumn ?? ''}
                              onChange={(event) =>
                                setQualityChoice((existing) => ({
                                  ...existing,
                                  [parameter.id]:
                                    event.target.value === ''
                                      ? null
                                      : Number(event.target.value),
                                }))
                              }
                            >
                              <option value="">
                                {t('imports.scores.notInFile')}
                              </option>
                              <ColumnOptions
                                columnCount={columnCount}
                                headerCells={headerCells}
                              />
                            </select>
                          </label>
                          <label className="inline">
                            {t('imports.scores.quantityCol')}
                            <select
                              value={columns.quantityColumn ?? ''}
                              onChange={(event) =>
                                setQuantityChoice((existing) => ({
                                  ...existing,
                                  [parameter.id]:
                                    event.target.value === ''
                                      ? null
                                      : Number(event.target.value),
                                }))
                              }
                            >
                              <option value="">
                                {t('imports.scores.notInFile')}
                              </option>
                              <ColumnOptions
                                columnCount={columnCount}
                                headerCells={headerCells}
                              />
                            </select>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                  {ignoredHeaders.length > 0 && (
                    <p className="hint">
                      {t('imports.scores.ignoredColumns', {
                        names: ignoredHeaders.join(', '),
                      })}
                    </p>
                  )}

                  {built && (
                    <p className="summary-line">
                      {t('imports.scores.summaryLine', {
                        rows: built.rows.length,
                        matched: built.rows.filter((item) => !item.rowProblem)
                          .length,
                        scores: built.entries.length,
                      })}
                      {built.localProblemCount > 0 &&
                        t('imports.scores.problemsNote', {
                          count: built.localProblemCount,
                        })}
                    </p>
                  )}
                  {tooMany && (
                    <p className="error">
                      {t('imports.scores.tooMany', {
                        count: built.entries.length,
                        max: MAX_SCORE_CELLS,
                      })}
                    </p>
                  )}
                  {built && built.entries.length === 0 && (
                    <p className="error">{t('imports.scores.noScores')}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleCheck}
                    disabled={
                      !built ||
                      built.entries.length === 0 ||
                      tooMany ||
                      check.isPending
                    }
                  >
                    {check.isPending
                      ? t('imports.checking')
                      : t('imports.checkFile')}
                  </button>
                  {check.isError && (
                    <p className="error" role="alert">
                      {errorMessage(check.error)}
                    </p>
                  )}
                </section>
              )}
            </>
          )}
        </>
      )}

      {stage === 'preview' && preview && plan && (
        <section className="section-card">
          <h2>
            {t('imports.scores.previewTitle', {
              name: fileName,
              date: chosenSession
                ? formatIsoDate(chosenSession.sessionDate)
                : '—',
            })}
          </h2>
          <p className="summary-line">
            <strong>
              {t('imports.scores.willBeSaved', { count: plan.send.length })}
            </strong>
            {server.redacted ? (
              plan.lockedOverride > 0
                ? t('imports.scores.lockedSuffix', { count: plan.lockedOverride })
                : ''
            ) : (
              <>
                {t('imports.scores.countsOpen', {
                  new: server.counts.new,
                  changed: server.counts.change,
                })}
                {plan.lockedOverride > 0 &&
                  t('imports.scores.countsLocked', { count: plan.lockedOverride })}
                {t('imports.scores.countsClose', { count: plan.unchanged })}
              </>
            )}
            {t('imports.scores.problemsTail', { count: plan.problemCount })}
          </p>

          {plan.problemCount > 0 && (
            <label className="inline">
              <input
                type="checkbox"
                checked={skipProblems}
                onChange={(event) => setSkipProblems(event.target.checked)}
              />
              {t('imports.scores.skipProblems')}
            </label>
          )}
          {needsReason && (
            <div className="pref-group">
              <label>
                {t('imports.scores.reasonLabel', {
                  count: plan.lockedOverride,
                })}
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  maxLength={300}
                />
              </label>
            </div>
          )}
          {plan.send.length === 0 && plan.problemCount === 0 && (
            <p>{t('imports.scores.nothingToImport')}</p>
          )}
          {plan.problemCount > 0 && !skipProblems && plan.send.length > 0 && (
            <p className="hint">{t('imports.scores.fixOrSkip')}</p>
          )}

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th rowSpan={2}>{t('imports.row')}</th>
                  <th rowSpan={2}>{t('imports.scores.colStudent')}</th>
                  {preview.built.mappedParameters.map((parameter) => (
                    <th
                      key={parameter.id}
                      colSpan={dimensionCount(preview.mapping[parameter.id])}
                    >
                      {parameter.path || parameter.name}
                    </th>
                  ))}
                </tr>
                <tr>
                  {preview.built.mappedParameters.map((parameter) => {
                    const columns = preview.mapping[parameter.id];
                    return (
                      <Fragment key={parameter.id}>
                        {columns.qualityColumn !== null && (
                          <th className="small">
                            {t('imports.scores.qualityCol')}
                          </th>
                        )}
                        {columns.quantityColumn !== null && (
                          <th className="small">
                            {t('imports.scores.quantityCol')}
                          </th>
                        )}
                      </Fragment>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {preview.built.rows.map((item) => (
                  <tr key={item.row} className={item.rowProblem ? 'bad' : undefined}>
                    <td>{item.row}</td>
                    <td>
                      {item.student
                        ? `${item.student.fullName} (${formatStudentCode(
                            item.student.studentCode
                          )})`
                        : item.rawCode || '—'}
                    </td>
                    {item.rowProblem ? (
                      <td colSpan={totalDimensions}>{item.rowProblem}</td>
                    ) : (
                      preview.built.mappedParameters.map((parameter) => (
                        <Fragment key={parameter.id}>
                          {item.cells
                            .filter((cell) => cell.parameterId === parameter.id)
                            .map((cell) => (
                              <td key={cell.dimension}>
                                <CellView
                                  cell={cell}
                                  info={serverByIndex.get(cell.entryIndex)}
                                  canOverride={canOverride}
                                />
                              </td>
                            ))}
                        </Fragment>
                      ))
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button type="button" onClick={handleImport} disabled={!canRun}>
              {run.isPending
                ? t('imports.importing')
                : t('imports.scores.importButton', { count: plan.send.length })}
            </button>
            <button type="button" onClick={backToSettings} disabled={run.isPending}>
              {t('imports.scores.backToColumns')}
            </button>
            <button type="button" onClick={resetFile} disabled={run.isPending}>
              {t('imports.chooseAnotherFile')}
            </button>
          </div>
          {run.isError && (
            <>
              <p className="error" role="alert">
                {errorMessage(run.error)}
              </p>
              <p className="hint">{t('imports.scores.staleHint')}</p>
            </>
          )}
        </section>
      )}

      {stage === 'done' && done && (
        <section className="section-card">
          <p className="success" role="status">
            {t('imports.scores.savedPrefix', { count: done.changed })}
            {done.unchanged > 0 &&
              t('imports.scores.sameSuffix', { count: done.unchanged })}
            {done.skipped > 0 &&
              t('imports.scores.skippedProblems', { count: done.skipped })}
            {'.'}
          </p>
          <div className="row">
            <Link to="/results">{t('imports.scores.seeResults')}</Link>
            <Link to="/evaluate">{t('imports.scores.backToEvaluate')}</Link>
            <button type="button" onClick={resetFile}>
              {t('imports.importAnotherFile')}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}

export default ImportScoresPage;
