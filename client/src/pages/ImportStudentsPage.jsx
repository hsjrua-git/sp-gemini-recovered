import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import Papa from 'papaparse';
import { Link } from 'react-router';
import { Trans, useTranslation } from 'react-i18next';
import { importStudents } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import EmptyState from '../components/EmptyState.jsx';
import ExportButton from '../components/ExportButton.jsx';
import ImportSteps from '../components/ImportSteps.jsx';
import { UploadIcon } from '../components/icons.jsx';
import { createdStudentsCsvRows } from '../lib/exports.js';
import { formatStudentCode, toIsoDate } from '../lib/format.js';
import { IDENTITY_COLUMNS, guessIdentityColumns, includeStudentIdentity } from '../lib/studentImport.js';
import {
  buildNames,
  guessColumns,
  looksLikeHeader,
  prepareRows,
} from '../lib/importNames.js';

const MAX_ROWS = 500;
const MAX_FILE_BYTES = 1_000_000;

function columnLabel(t, index, headerCells) {
  const header = headerCells ? String(headerCells[index] ?? '').trim() : '';
  return header
    ? t('imports.columnWithHeader', { index: index + 1, header })
    : t('imports.columnN', { index: index + 1 });
}

function describeRow(t, item) {
  if (item.status === 'invalid') {
    return t('imports.students.skippedMessage', { message: item.message });
  }
  if (item.status === 'ok') return t('imports.students.willBeAdded');
  if (item.willImport) {
    return t('imports.students.willBeAddedNote', { note: item.message });
  }
  const code = item.existingCode
    ? t('imports.students.existingCode', {
        code: formatStudentCode(item.existingCode),
      })
    : '';
  return (
    t('imports.students.skippedMessage', { message: item.message }) + code
  );
}

function ColumnSelect({ label, value, onChange, columnCount, headerCells, allowEmpty = false }) {
  const { t } = useTranslation(['students', 'common']);
  return (
    <label className="inline">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {allowEmpty && <option value={-1}>{t('detail.notSet')}</option>}
        {Array.from({ length: columnCount }, (_, index) => (
          <option key={index} value={index}>
            {columnLabel(t, index, headerCells)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ImportStudentsPage() {
  const { t } = useTranslation(['students', 'common']);
  const queryClient = useQueryClient();
  const { can } = useAuth();

  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState([]);
  const [parseError, setParseError] = useState(null);
  const [hasHeader, setHasHeader] = useState(false);
  const [mode, setMode] = useState('single');
  const [firstColumn, setFirstColumn] = useState(0);
  const [secondColumn, setSecondColumn] = useState(1);
  const [identityColumns, setIdentityColumns] = useState(() => guessIdentityColumns());
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [stage, setStage] = useState('choose');
  const [done, setDone] = useState(null);

  const check = useMutation({ mutationFn: importStudents });
  const run = useMutation({ mutationFn: importStudents });

  const columnCount = rows.reduce(
    (max, item) => Math.max(max, item.cells.length),
    0
  );
  const headerCells = hasHeader ? rows[0]?.cells : null;
  const names = useMemo(
    () =>
      includeStudentIdentity(buildNames({
        rows,
        hasHeader,
        mode,
        firstColumn,
        secondColumn: mode === 'two' ? secondColumn : null,
      }), rows, identityColumns),
    [rows, hasHeader, mode, firstColumn, secondColumn, identityColumns]
  );

  function startOver() {
    setFileName('');
    setRows([]);
    setParseError(null);
    setHasHeader(false);
    setMode('single');
    setFirstColumn(0);
    setSecondColumn(1);
    setIdentityColumns(guessIdentityColumns());
    setAllowDuplicates(false);
    setStage('choose');
    setDone(null);
    check.reset();
    run.reset();
  }

  async function handleFile(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;

    startOver();
    setFileName(file.name);
    if (file.size > MAX_FILE_BYTES) {
      setParseError(t('imports.fileTooLarge', { size: '1 MB' }));
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

    const header = looksLikeHeader(prepared[0].cells);
    const guess = header
      ? guessColumns(prepared[0].cells)
      : { mode: 'single', firstColumn: 0, secondColumn: null };

    setRows(prepared);
    setHasHeader(header);
    setMode(guess.mode);
    setFirstColumn(guess.firstColumn);
    setSecondColumn(guess.secondColumn ?? 1);
    setIdentityColumns(guessIdentityColumns(header ? prepared[0].cells : []));
  }

  function handleCheck() {
    check.mutate(
      { rows: names, allowDuplicateNames: allowDuplicates, dryRun: true },
      { onSuccess: () => setStage('preview') }
    );
  }

  function handleAllowChange(checked) {
    setAllowDuplicates(checked);
    check.mutate({ rows: names, allowDuplicateNames: checked, dryRun: true });
  }

  function handleImport() {
    run.mutate(
      { rows: names, allowDuplicateNames: allowDuplicates, dryRun: false },
      {
        onSuccess: (data) => {
          setDone(data);
          setStage('done');
          queryClient.invalidateQueries({ queryKey: ['students'] });
        },
      }
    );
  }

  if (!can('data.import')) {
    return (
      <main>
        <EmptyState
          title={t('shared.readOnlyTitle')}
          description={t('imports.students.readOnlyDescription')}
        />
      </main>
    );
  }

  const tooMany = names.length > MAX_ROWS;
  const result = check.data;

  return (
    <main className="wide">
      <p>
        <Link to="/students">{t('detail.back')}</Link>
      </p>
      <h1>{t('imports.students.title')}</h1>
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
          <p className="hint">{t('imports.students.hint')}</p>
          <div className="drop-zone">
            <span className="drop-zone-mark">
              <UploadIcon />
            </span>
            <input
              type="file"
              accept=".csv,.txt,text/csv"
              aria-label={t('imports.students.fileAria')}
              onChange={handleFile}
            />
          </div>
          {parseError && (
            <p className="error" role="alert">
              {parseError}
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
                        <th key={index}>
                          {columnLabel(t, index, null)}
                        </th>
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
                    onChange={(event) => setHasHeader(event.target.checked)}
                  />
                  {t('imports.firstRowHeader')}
                </label>
                <label className="inline">
                  {t('imports.students.namesIn')}
                  <select value={mode} onChange={(event) => setMode(event.target.value)}>
                    <option value="single">
                      {t('imports.students.modeSingle')}
                    </option>
                    <option value="two">{t('imports.students.modeTwo')}</option>
                  </select>
                </label>
                <ColumnSelect
                  label={
                    mode === 'two'
                      ? t('imports.students.firstName')
                      : t('list.fullName')
                  }
                  value={firstColumn}
                  onChange={setFirstColumn}
                  columnCount={columnCount}
                  headerCells={headerCells}
                />
                {mode === 'two' && (
                  <ColumnSelect
                    label={t('imports.students.lastName')}
                    value={secondColumn}
                    onChange={setSecondColumn}
                    columnCount={columnCount}
                    headerCells={headerCells}
                  />
                )}
              </div>

              <p className="hint">{t('imports.students.identityHint')}</p>
              <div className="pref-group">
                {IDENTITY_COLUMNS.map(field => <ColumnSelect key={field}
                  label={t(`detail.${field}`)} value={identityColumns[field]}
                  onChange={value => setIdentityColumns(current => ({ ...current, [field]: value }))}
                  columnCount={columnCount} headerCells={headerCells} allowEmpty />)}
              </div>

              {tooMany && (
                <p className="error">
                  {t('imports.students.tooMany', {
                    count: names.length,
                    max: MAX_ROWS,
                  })}
                </p>
              )}
              <button
                type="button"
                onClick={handleCheck}
                disabled={names.length === 0 || tooMany || check.isPending}
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

      {stage === 'preview' && result && (
        <section className="section-card">
          <h2>{fileName}</h2>
          <p className="summary-line">
            <Trans
              t={t}
              i18nKey="imports.students.checkedSummary"
              values={{
                total: result.counts.total,
                willImport: result.counts.willImport,
                skipped: result.counts.skipped,
                invalid: result.counts.invalid,
                duplicates: result.counts.duplicates,
              }}
              components={{ strong: <strong /> }}
            />
          </p>
          <label className="inline">
            <input
              type="checkbox"
              checked={allowDuplicates}
              onChange={(event) => handleAllowChange(event.target.checked)}
              disabled={check.isPending}
            />
            {t('imports.students.allowDuplicates')}
          </label>

          <div className="table-wrap">
            <table className={check.isPending ? 'stale' : undefined}>
              <thead>
                <tr>
                  <th>{t('imports.row')}</th>
                  <th>{t('list.fullName')}</th>
                  <th>{t('imports.students.whatWillHappen')}</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((item) => (
                  <tr
                    key={item.row}
                    className={item.willImport ? undefined : 'bad'}
                  >
                    <td>{item.row}</td>
                    <td>{item.fullName}</td>
                    <td>{describeRow(t, item)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="row">
            <button
              type="button"
              onClick={handleImport}
              disabled={
                result.counts.willImport === 0 || run.isPending || check.isPending
              }
            >
              {run.isPending
                ? t('imports.importing')
                : t('imports.students.importButton', {
                    count: result.counts.willImport,
                  })}
            </button>
            <button type="button" onClick={startOver} disabled={run.isPending}>
              {t('imports.chooseAnotherFile')}
            </button>
          </div>
          {check.isError && (
            <p className="error" role="alert">
              {errorMessage(check.error)}
            </p>
          )}
          {run.isError && (
            <p className="error" role="alert">
              {errorMessage(run.error)}
            </p>
          )}
        </section>
      )}

      {stage === 'done' && done && (
        <section className="section-card">
          <p className="success" role="status">
            {t('imports.students.added', { count: done.created.length })}
            {done.counts.skipped > 0 &&
              t('imports.students.skippedRows', { count: done.counts.skipped })}
            {'.'}
          </p>
          <p className="hint">{t('imports.students.doneHint')}</p>
          <div className="row">
            <ExportButton
              label={t('imports.students.downloadList')}
              filename={`imported-students-${toIsoDate(new Date())}.csv`}
              buildRows={() => createdStudentsCsvRows(done.created)}
            />
            <Link to="/students">{t('imports.students.goToStudents')}</Link>
            <button type="button" onClick={startOver}>
              {t('imports.importAnotherFile')}
            </button>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('imports.row')}</th>
                  <th>{t('common:table.code')}</th>
                  <th>{t('list.fullName')}</th>
                </tr>
              </thead>
              <tbody>
                {done.created.map((student) => (
                  <tr key={student.id}>
                    <td>{student.row}</td>
                    <td className="code">
                      {formatStudentCode(student.studentCode)}
                    </td>
                    <td>{student.fullName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}

export default ImportStudentsPage;
