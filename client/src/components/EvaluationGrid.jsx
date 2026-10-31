import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cellAccess, cellKey, savedText } from '../lib/cells.js';
import { formatDateTime, formatStudentCode, formatParameterHint } from '../lib/format.js';
import { hierarchyLabel } from '../lib/hierarchy.js';
import { LockIcon, NoteFilledIcon, NoteIcon } from './icons.jsx';

function lockTitle(t, saved, access) {
  if (!saved) return undefined;
  if (saved.isLocked) {
    return access === 'override'
      ? t('evaluate.lockedSinceOverride', { date: formatDateTime(saved.locksAt) })
      : t('evaluate.lockedSinceAdmin', { date: formatDateTime(saved.locksAt) });
  }
  return t('evaluate.changeableUntil', { date: formatDateTime(saved.locksAt) });
}

// One target's row (a member, or the whole group). It is wrapped in
// React.memo (see rowsEqual) so that typing in a cell only re-renders the row
// that changed, not the whole targets × parameters grid — the difference
// between one input updating and hundreds re-rendering per keystroke. It
// pulls its own `t` from useTranslation (rather than a prop, which rowsEqual
// would ignore) so a language switch still re-renders every row.
const EvaluationRow = memo(function EvaluationRow({
  target,
  parameters,
  savedByCell,
  drafts,
  cellErrors,
  onCellChange,
  canOverride,
  openNote,
  onOpenNoteChange,
}) {
  const { t } = useTranslation(['students', 'common']);

  return (
    <tr className={target.isGroup ? 'group-row' : undefined}>
      <th scope="row">
        {target.name}
        <div className="hint code">
          {target.isGroup
            ? t('evaluate.wholeGroup')
            : target.code ? formatStudentCode(target.code) : '—'}
        </div>
      </th>
      {parameters.map((parameter) => {
        const key = cellKey(target.membershipId, parameter.id);
        const saved = savedByCell.get(key) ?? null;
        const draft = drafts[key];
        const access = cellAccess(saved, canOverride);
        const locked = access === 'locked';
        const selected = draft?.selected ?? saved !== null;
        const changed = draft !== undefined && draft.selected !== false;

        const qualityShown = draft?.qualityText ?? savedText(saved?.qualityValue);
        const quantityShown = draft?.quantityText ?? savedText(saved?.quantityValue);
        const qualityError = cellErrors[key]?.quality;
        const quantityError = cellErrors[key]?.quantity;
        const generalError = cellErrors[key]?.general;

        const originalNote = [
          savedText(saved?.qualityComment),
          savedText(saved?.quantityComment),
        ];
        const shownNotes = [
          'qualityComment' in (draft ?? {}) ? draft.qualityComment : originalNote[0],
          'quantityComment' in (draft ?? {}) ? draft.quantityComment : originalNote[1],
        ];
        const hasNote = shownNotes.some((note) => note.trim() !== '');
        const noteChanged = draft !== undefined &&
          ('qualityComment' in draft || 'quantityComment' in draft);
        const isNoteOpen = openNote === key;

        const inputClasses = (message) =>
          [
            'cell dim',
            changed ? 'changed' : '',
            message ? 'invalid' : '',
            locked ? 'locked' : '',
            !selected ? 'off' : '',
          ]
            .filter(Boolean)
            .join(' ');

        const title = lockTitle(t, saved, access);

        return (
          <td key={parameter.id}>
            <div className="cell-wrap eval-cell">
              <input
                type="checkbox"
                className="cell-select"
                checked={selected}
                disabled={locked}
                title={
                  selected
                    ? t('evaluate.deselectTitle')
                    : t('evaluate.selectTitle')
                }
                aria-label={t('evaluate.selectAriaLabel', {
                  parameter: parameter.name,
                  student: target.name,
                })}
                onChange={(event) =>
                  onCellChange(key, { selected: event.target.checked })
                }
              />
              <label className="eval-dimension">
              <span>{t('evaluate.quality')}</span>
              <input
                id={`evaluation-${key}-quality`}
                className={inputClasses(qualityError)}
                aria-invalid={Boolean(qualityError)}
                inputMode="numeric"
                value={qualityShown}
                disabled={!selected || locked}
                title={title}
                placeholder={t('evaluate.qualityShort')}
                aria-label={t('evaluate.dimensionAriaLabel', {
                  dimension: t('evaluate.quality'),
                  parameter: parameter.name,
                  student: target.name,
                })}
                autoComplete="off"
                onChange={(event) =>
                  onCellChange(key, {
                    qualityText: event.target.value,
                    selected: true,
                  })
                }
              />
              </label>
              <label className="eval-dimension">
              <span>{t('evaluate.quantity')}</span>
              <input
                id={`evaluation-${key}-quantity`}
                className={inputClasses(quantityError)}
                aria-invalid={Boolean(quantityError)}
                inputMode="numeric"
                value={quantityShown}
                disabled={!selected || locked}
                title={title}
                placeholder={t('evaluate.quantityShort')}
                aria-label={t('evaluate.dimensionAriaLabel', {
                  dimension: t('evaluate.quantity'),
                  parameter: parameter.name,
                  student: target.name,
                })}
                autoComplete="off"
                onChange={(event) =>
                  onCellChange(key, {
                    quantityText: event.target.value,
                    selected: true,
                  })
                }
              />
              </label>
              {locked && (
                <span className="lock" aria-hidden="true">
                  <LockIcon />
                </span>
              )}
              {onCellChange && (
                <button
                  type="button"
                  className={`note-toggle${hasNote ? ' has-note' : ''}${
                    noteChanged ? ' changed' : ''
                  }`}
                  aria-label={
                    (hasNote ? t('common:actions.edit') : t('common:actions.add')) +
                    ' ' +
                    t('evaluate.noteFor', {
                      parameter: parameter.name,
                      student: target.name,
                    })
                  }
                  aria-expanded={isNoteOpen}
                  title={hasNote ? t('evaluate.editNoteTitle') : t('evaluate.addNoteTitle')}
                  onClick={() => onOpenNoteChange(isNoteOpen ? null : key)}
                >
                  {hasNote ? <NoteFilledIcon /> : <NoteIcon />}
                </button>
              )}
            </div>
            {onCellChange && isNoteOpen && (
              <div className="cell-note-pair">
                <textarea
                  className="cell-note"
                  rows={2}
                  maxLength={500}
                  value={shownNotes[0]}
                  disabled={locked}
                  placeholder={t('evaluate.qualityNotePlaceholder')}
                  aria-label={t('evaluate.noteAriaLabel', {
                    dimension: t('evaluate.quality'),
                    parameter: parameter.name,
                    student: target.name,
                  })}
                  onChange={(event) =>
                    onCellChange(key, {
                      qualityComment: event.target.value,
                      selected: true,
                    })
                  }
                />
                <textarea
                  className="cell-note"
                  rows={2}
                  maxLength={500}
                  value={shownNotes[1]}
                  disabled={locked}
                  placeholder={t('evaluate.quantityNotePlaceholder')}
                  aria-label={t('evaluate.noteAriaLabel', {
                    dimension: t('evaluate.quantity'),
                    parameter: parameter.name,
                    student: target.name,
                  })}
                  onChange={(event) =>
                    onCellChange(key, {
                      quantityComment: event.target.value,
                      selected: true,
                    })
                  }
                />
              </div>
            )}
            {(qualityError || quantityError || generalError) && (
              <div className="error small">
                {[generalError, qualityError, quantityError]
                  .filter(Boolean)
                  .join(' ')}
              </div>
            )}
          </td>
        );
      })}
    </tr>
  );
}, rowsEqual);

// Custom equality for a row. The shared objects (savedByCell) are rebuilt
// only when the server data refetches, so their reference is a reliable
// signal. The draft map and the open-note key change on every keystroke, so
// for those we compare just this row's own cells (draft cell objects are
// replaced immutably on each edit) and skip the re-render when none of them
// moved.
function rowsEqual(prev, next) {
  if (
    prev.target !== next.target ||
    prev.parameters !== next.parameters ||
    prev.canOverride !== next.canOverride ||
    prev.onCellChange !== next.onCellChange ||
    prev.onOpenNoteChange !== next.onOpenNoteChange ||
    prev.savedByCell !== next.savedByCell
  ) {
    return false;
  }

  const openChanged = prev.openNote !== next.openNote;
  for (const parameter of next.parameters) {
    const key = cellKey(next.target.membershipId, parameter.id);
    const prevDraft = prev.drafts[key];
    const nextDraft = next.drafts[key];
    if (prevDraft !== nextDraft) return false;
    const prevError = prev.cellErrors[key];
    const nextError = next.cellErrors[key];
    if (
      prevError?.quality !== nextError?.quality ||
      prevError?.quantity !== nextError?.quantity ||
      prevError?.general !== nextError?.general
    ) {
      return false;
    }
    if (openChanged && (prev.openNote === key || next.openNote === key)) {
      return false;
    }
  }
  return true;
}

// The session's entry grid: rows are the assignment's targets (the whole-group
// row first, then members), columns are the parameters. A cell is a select
// toggle plus both dimension inputs — the row itself is the expectation, so
// selecting a cell creates it (answered or not) and deselecting deletes it.
function EvaluationGrid({
  targets,
  parameters,
  savedByCell,
  drafts,
  cellErrors,
  onCellChange,
  canOverride,
}) {
  const { t } = useTranslation(['students', 'common']);
  const [openNote, setOpenNote] = useState(null);

  if (parameters.length === 0) {
    return <p>{t('evaluate.gridNoParameters')}</p>;
  }

  return (
    <div className="table-wrap evaluation-table" tabIndex={0} role="region" aria-label={t('evaluate.title')}>
      <table className="grid">
        <thead>
          <tr>
            <th>{t('evaluate.colStudent')}</th>
            {parameters.map((parameter) => (
              <th key={parameter.id}>
                <span title={parameter.path}>{hierarchyLabel(parameter)}</span>
                <div className="hint">{formatParameterHint(parameter, 'both')}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {targets.map((target) => (
            <EvaluationRow
              key={target.membershipId ?? 'group'}
              target={target}
              parameters={parameters}
              savedByCell={savedByCell}
              drafts={drafts}
              cellErrors={cellErrors}
              onCellChange={onCellChange}
              canOverride={canOverride}
              openNote={openNote}
              onOpenNoteChange={setOpenNote}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default EvaluationGrid;
