import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { listEvaluations, saveEvaluations } from '../api/evaluations.js';
import { listParameters } from '../api/parameters.js';
import { listGroupMembers, listGroups } from '../api/groups.js';
import { listAssignments } from '../api/schedule.js';
import { listSessions } from '../api/sessions.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import EmptyState from '../components/EmptyState.jsx';
import EvaluationGrid from '../components/EvaluationGrid.jsx';
import {
  buildSaveEntries,
  cellKey,
  lockedDraftKeys,
  parseDimension,
  pruneDraft,
  splitCellKey,
} from '../lib/cells.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import HierarchySelect from '../components/HierarchySelect.jsx';
import EvaluationTasks from '../components/EvaluationTasks.jsx';
import { assignmentTree } from '../lib/hierarchy.js';
import TreePicker from '../components/TreePicker.jsx';

function EvaluatePage() {
  const queryClient = useQueryClient();
  const { t } = useTranslation(['students', 'common', 'recovery']);
  const { can } = useAuth();

  const [searchParams] = useSearchParams();
  const [assignmentId, setAssignmentId] = useState(() => searchParams.get('assignmentId'));
  const [sessionId, setSessionId] = useState(() => searchParams.get('sessionId'));
  const [selectedParamIds, setSelectedParamIds] = useState(null);
  const [errorFocus, setErrorFocus] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [overrideReason, setOverrideReason] = useState('');

  const canViewScores = can('scores.view');

  const assignmentsQuery = useQuery({
    queryKey: ['assignments'],
    queryFn: listAssignments,
  });
  const assignments = assignmentsQuery.data ?? [];
  const groups = useQuery({ queryKey: ['groups'], queryFn: listGroups });

  // The assignment the grid shows: the user's pick, else the first one —
  // derived (not an effect) so the picker always has a coherent selection.
  const effectiveAssignmentId = assignmentId ?? assignments[0]?.id ?? null;

  const sessionsQuery = useQuery({
    queryKey: ['sessions', { assignmentId: effectiveAssignmentId }],
    queryFn: () =>
      listSessions({
        assignmentId: effectiveAssignmentId,
        includeCanceled: true,
        includeArchived: true,
      }),
    enabled: effectiveAssignmentId !== null,
  });
  const sessionsRaw = sessionsQuery.data?.sessions;
  const sessions = useMemo(() => sessionsRaw ?? [], [sessionsRaw]);

  // Default session: the first session of today or later, else the latest
  // usable one. Derived (not an effect) so the picker falls back to it
  // whenever the user has not explicitly chosen.
  const defaultSessionId = useMemo(() => {
    const usable = sessions.filter(
      (session) => !session.canceledAt && !session.archivedAt
    );
    if (usable.length === 0) return null;
    const today = toIsoDate(new Date());
    return (
      usable.find((session) => session.sessionDate >= today) ??
      usable[usable.length - 1]
    ).id;
  }, [sessions]);
  const effectiveSessionId = sessionId ?? defaultSessionId;
  const effectiveSession =
    sessions.find((item) => item.id === effectiveSessionId) ?? null;
  const effectiveSessionDate = effectiveSession?.sessionDate ?? null;

  const parametersQuery = useQuery({
    queryKey: ['parameters'],
    queryFn: listParameters,
  });
  const parameters = useMemo(
    () => (parametersQuery.data ?? []).filter((parameter) => !parameter.archivedAt),
    [parametersQuery.data]
  );
  const parametersById = useMemo(
    () => new Map(parameters.map((parameter) => [parameter.id, parameter])),
    [parameters]
  );
  const visibleParameters = useMemo(() => selectedParamIds === null ? parameters : parameters.filter(parameter => selectedParamIds.includes(parameter.id)), [parameters, selectedParamIds]);

  useEffect(() => {
    if (!errorFocus) return;
    const input = document.getElementById(`evaluation-${errorFocus.key}-${errorFocus.dimension}`);
    if (input) {
      input.scrollIntoView({ block: 'center', inline: 'center' });
      input.focus({ preventScroll: true });
    }
  }, [errorFocus]);

  // Existing cells of this session. Blind-entry roles (scores.enter without
  // scores.view) never fetch them: their grid starts empty and the server
  // never reads values back to them.
  const savedQuery = useQuery({
    queryKey: ['evaluations', { sessionId: effectiveSessionId }],
    queryFn: () => listEvaluations({ sessionId: effectiveSessionId }),
    enabled: effectiveSessionId !== null && canViewScores,
  });

  const assignment =
    assignments.find((item) => item.id === effectiveAssignmentId) ?? null;

  const membersQuery = useQuery({
    queryKey: ['group-members', assignment?.groupId],
    queryFn: () => listGroupMembers(assignment.groupId),
    enabled: assignment?.groupId != null,
  });

  const targets = useMemo(() => {
    if (!assignment) return [];
    if (assignment.groupId) {
      const rawMembers = Array.isArray(membersQuery.data)
        ? membersQuery.data
        : (membersQuery.data?.students ?? []);
      const members = rawMembers
        .filter(
          (member) =>
            effectiveSessionDate &&
            member.joinedOn <= effectiveSessionDate &&
            (!member.leftOn || member.leftOn >= effectiveSessionDate)
        )
        .map((member) => ({
          membershipId: member.membershipId,
          name: member.fullName,
          code: member.studentCode,
          isGroup: false,
        }));
      return [
        {
          membershipId: null,
          name: assignment.groupName,
          code: null,
          isGroup: true,
        },
        ...members,
      ];
    }
    // An individual assignment targets exactly its own member — no whole-group
    // row (the server refuses one).
    return [
      {
        membershipId: assignment.membershipId,
        name: assignment.studentName,
        code: null,
        isGroup: false,
      },
    ];
  }, [assignment, effectiveSessionDate, membersQuery.data]);

  const savedByCell = useMemo(() => {
    const map = new Map();
    for (const row of savedQuery.data ?? []) {
      map.set(cellKey(row.membershipId, row.parameterId), row);
    }
    return map;
  }, [savedQuery.data]);

  const mutation = useMutation({
    mutationFn: saveEvaluations,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['evaluations'] }),
        queryClient.invalidateQueries({ queryKey: ['results'] }),
        queryClient.invalidateQueries({ queryKey: ['trends'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
        queryClient.invalidateQueries({ queryKey: ['periods'] }),
      ]);
      setDrafts({});
      setOverrideReason('');
    },
  });
  // Read the mutation through a ref so the cell change handler can stay
  // referentially stable (see useCallback below); the memoized EvaluationRow
  // relies on that callback not changing identity between keystrokes.
  const mutationRef = useRef(mutation);
  useEffect(() => {
    mutationRef.current = mutation;
  }, [mutation]);

  const draftCount = Object.keys(drafts).length;
  const lockedCount = lockedDraftKeys(drafts, savedByCell).length;
  const hasLiveErrors = useMemo(() => {
    for (const [key, draft] of Object.entries(drafts)) {
      const parameter = parametersById.get(splitCellKey(key).parameterId);
      if (!parameter) continue;
      if (
        ('qualityText' in draft &&
          parseDimension(draft.qualityText, parameter, 'quality').error) ||
        ('quantityText' in draft &&
          parseDimension(draft.quantityText, parameter, 'quantity').error)
      ) {
        return true;
      }
    }
    return false;
  }, [drafts, parametersById]);

  const serverErrors = useMemo(
    () =>
      Object.fromEntries(
        (mutation.error?.data?.problems ?? []).map((problem) => [
          cellKey(problem.membershipId, problem.parameterId),
          { general: problem.message },
        ])
      ),
    [mutation.error]
  );

  const cellErrors = useMemo(() => {
    // Per-cell parse errors straight from the drafts, merged with the save
    // attempt's server-side problems.
    const errors = {};
    for (const [key, draft] of Object.entries(drafts)) {
      const parameter = parametersById.get(splitCellKey(key).parameterId);
      if (!parameter) continue;
      const forCell = {};
      if ('qualityText' in draft) {
        const result = parseDimension(draft.qualityText, parameter, 'quality');
        if (result.error) forCell.quality = result.error;
      }
      if ('quantityText' in draft) {
        const result = parseDimension(draft.quantityText, parameter, 'quantity');
        if (result.error) forCell.quantity = result.error;
      }
      if (Object.keys(forCell).length > 0) errors[key] = forCell;
    }
    return { ...errors, ...serverErrors };
  }, [drafts, parametersById, serverErrors]);

  const handleCellChange = useCallback(
    (key, patch) => {
      if (!mutationRef.current.isIdle) mutationRef.current.reset();
      setDrafts((current) => {
        const draft = { ...(current[key] ?? {}), ...patch };
        const parameter = parametersById.get(splitCellKey(key).parameterId);
        if (!parameter) {
          return { ...current, [key]: draft };
        }
        // A draft that resolves to exactly the saved state changes nothing —
        // drop it so the dirty count and the payload stay honest.
        const pruned = pruneDraft(draft, savedByCell.get(key) ?? null, parameter);
        const next = { ...current };
        if (pruned === null) delete next[key];
        else next[key] = pruned;
        return next;
      });
    },
    [parametersById, savedByCell]
  );

  function clearDrafts() {
    setDrafts({});
    setOverrideReason('');
    mutation.reset();
  }

  function handleSwitch(nextAssignmentId, nextSessionId) {
    if (
      nextAssignmentId === effectiveAssignmentId &&
      nextSessionId === effectiveSessionId
    ) {
      return;
    }
    if (draftCount > 0 && !window.confirm(t('evaluate.unsavedConfirm'))) {
      return;
    }
    // Re-selecting the derived first assignment stores it explicitly so the
    // select stays honest; a null session lets the default re-derive.
    setAssignmentId(nextAssignmentId);
    setSessionId(nextSessionId ?? null);
    clearDrafts();
  }

  function handleSave() {
    const { entries, errors } = buildSaveEntries({
      drafts,
      savedByCell,
      parametersById,
    });
    if (Object.keys(errors).length > 0 || entries.length === 0) return;

    if (lockedCount > 0 && overrideReason.trim().length < 5) return;
    mutation.mutate({ sessionId: effectiveSessionId, entries,
      overrideReason: lockedCount > 0 ? overrideReason.trim() : undefined });
  }

  useEffect(() => {
    if (draftCount === 0) return;
    function warn(event) {
      event.preventDefault();
    }
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [draftCount]);

  if (!can('scores.enter')) {
    return (
      <main>
        <h1>{t('evaluate.title')}</h1>
        <EmptyState
          title={t('shared.readOnlyTitle')}
          description={t('evaluate.readOnlyDescription')}
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
          title={t('evaluate.loadErrorTitle')}
          description={errorMessage(assignmentsQuery.error)}
        />
      </main>
    );
  }
  if (assignments.length === 0) {
    return (
      <main>
        <h1>{t('evaluate.title')}</h1>
        <EmptyState
          title={t('evaluate.noAssignments')}
          description={t('evaluate.noAssignmentsDescription')}
        >
          <p>
            <Link to="/schedule">{t('evaluate.goToSchedule')}</Link>
          </p>
        </EmptyState>
      </main>
    );
  }

  // Disabled queries stay pending without fetching. Only required dependencies
  // gate the grid: individuals need no roster, blind entry reads no saved cells.
  const needsSaved = canViewScores && effectiveSessionId !== null;
  const needsMembers = assignment?.groupId != null;
  const isLoading = parametersQuery.isPending || sessionsQuery.isPending ||
    (needsSaved && savedQuery.isPending) || (needsMembers && membersQuery.isPending);
  const loadError = parametersQuery.error ?? sessionsQuery.error ??
    (needsSaved ? savedQuery.error : null) ?? (needsMembers ? membersQuery.error : null);

  let saveLabel = t('common:actions.save');
  if (mutation.isPending) {
    saveLabel = t('common:actions.saving');
  } else if (draftCount > 0) {
    saveLabel =
      t('evaluate.saveCount', { count: draftCount }) +
      (lockedCount > 0
        ? t('evaluate.saveLockedSuffix', { count: lockedCount })
        : '');
  }

  return (
    <main className="wide evaluate-page">
      <div className="page-head">
        <div><p className="eyebrow">{t('recovery:evaluate.workspace')}</p><h1>{t('evaluate.title')}</h1><p className="hint">{t('recovery:evaluate.hint')}</p></div>
        {can('data.import') && (
          <div className="page-head-actions">
            <Link className="btn" to="/evaluate/import">
              {t('evaluate.importScores')}
            </Link>
          </div>
        )}
      </div>

      <div className="control-bar">
        <label className="field">
          <span>{t('evaluate.assignmentLabel')}</span>
          <HierarchySelect items={assignmentTree(assignments, groups.data ?? [])} value={effectiveAssignmentId ?? ''} onChange={id => handleSwitch(id || null, null)} />
        </label>
        <label className="field">
          <span>{t('evaluate.sessionLabel')}</span>
          <select
            value={effectiveSessionId ?? ''}
            onChange={(event) =>
              handleSwitch(effectiveAssignmentId, event.target.value || null)
            }
            disabled={sessions.length === 0}
          >
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {formatIsoDate(session.sessionDate)}
                {' · '}
                 {t('evaluate.periodShort', {
                   seq: session.periodSeq ?? '…',
                 })}
                {session.canceledAt ? t('evaluate.canceledTag') : ''}
              </option>
            ))}
          </select>
        </label>
        <span className="spacer" />
        <button
          type="button"
          className="primary"
          onClick={handleSave}
          disabled={draftCount === 0 || hasLiveErrors || mutation.isPending || (lockedCount > 0 && overrideReason.trim().length < 5)}
        >
          {saveLabel}
        </button>
        <button
          type="button"
          onClick={clearDrafts}
          disabled={draftCount === 0 || mutation.isPending}
        >
          {t('evaluate.discard')}
        </button>
      </div>

      {lockedCount > 0 && <label className="field section-card">
        <span>{t('evaluate.overridePrompt', { count: lockedCount })}</span>
        <textarea value={overrideReason} onChange={event => setOverrideReason(event.target.value)} minLength={5} maxLength={300} rows={2} disabled={mutation.isPending} />
      </label>}
      {!canViewScores && <p className="hint">{t('evaluate.blindHint')}</p>}
      {effectiveSession && <details className="panel evaluation-tasks-disclosure"><summary>{t('recovery:evaluate.tasks')}</summary><EvaluationTasks key={effectiveSession.id} session={effectiveSession} sessions={sessions} /></details>}
      <p className="hint">
        {t('evaluate.lockHint')}
        {can('scores.override')
          ? t('evaluate.lockHintOverride')
          : t('evaluate.lockHintNoOverride')}
      </p>

      {Object.keys(cellErrors).length > 0 && (
        <p className="error" role="alert">
          {t('evaluate.fixCells')}
          {' '}<button type="button" onClick={() => {
            const key = Object.keys(cellErrors)[0];
            const { parameterId } = splitCellKey(key);
            setSelectedParamIds(current => current === null || current.includes(parameterId) ? current : [...current, parameterId]);
            setErrorFocus({ key, dimension: cellErrors[key].quantity && !cellErrors[key].quality ? 'quantity' : 'quality' });
          }}>{t('recovery:evaluate.showError')}</button>
        </p>
      )}
      {mutation.isError && (
        <p className="error" role="alert">
          {errorMessage(mutation.error)}
        </p>
      )}
      {mutation.isSuccess && (
        <p className="success" role="status">
          {t('evaluate.saved', { count: mutation.data.changed })}
        </p>
      )}

      {sessionsQuery.isSuccess && sessions.length === 0 && (
        <EmptyState
          title={t('evaluate.noSessions')}
          description={t('evaluate.noSessionsDescription')}
        >
          <p>
            <Link to="/schedule">{t('evaluate.goToSchedule')}</Link>
          </p>
        </EmptyState>
      )}

      {loadError && <p className="error">{errorMessage(loadError)}</p>}
      {isLoading && !loadError && effectiveSessionId !== null && (
        <p className="hint">{t('common:status.loading')}</p>
      )}
      {effectiveSessionId !== null && !isLoading && !loadError && (
        <>
        <section className="section-card evaluation-picker">
          <div><h2>{t('recovery:evaluate.parameters')}</h2><p className="hint">{t('recovery:evaluate.visibilityHint')}</p></div>
          <TreePicker label={t('recovery:evaluate.columns', { shown: visibleParameters.length, total: parameters.length })} items={parameters} value={visibleParameters.map(p => p.id)} onChange={setSelectedParamIds} includeBranch />
          {selectedParamIds !== null && <button type="button" className="quiet" onClick={() => setSelectedParamIds(null)}>{t('recovery:evaluate.showAll')}</button>}
        </section>
        <EvaluationGrid
          targets={targets}
          parameters={visibleParameters}
          savedByCell={savedByCell}
          drafts={drafts}
          cellErrors={cellErrors}
          onCellChange={handleCellChange}
          canOverride={can('scores.override')}
        />
        </>
      )}
    </main>
  );
}

export default EvaluatePage;
