import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  archiveAssignment,
  archiveInterval,
  createAssignment,
  createInterval,
  listAssignments,
  listIntervals,
  listStudentMemberships,
  updateAssignment,
  updateInterval,
} from '../api/schedule.js';
import { listGroups } from '../api/groups.js';
import { listStudents } from '../api/students.js';
import { listTeachers } from '../api/teachers.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { errorMessage } from '../i18n/errors.js';
import MultiAssignmentForm from '../components/MultiAssignmentForm.jsx';
import CreateSection from '../components/CreateSection.jsx';

// The schedule lists recurring assignments: a teacher meets a group (or one
// student) on an interval from an anchor date. Sessions are generated from
// these; the assignment itself stores no occurrences.

function normalizeEvery(every) {
  if (!every) return null;
  if (typeof every === 'string') {
    const years = Number(every.match(/(\d+)\s*year/i)?.[1] ?? 0);
    const months = Number(every.match(/(\d+)\s*mon/i)?.[1] ?? 0) + years * 12;
    const days = Number(every.match(/(\d+)\s*day/i)?.[1] ?? 0);
    return { months, days };
  }
  const months = (Number(every.years) || 0) * 12 + (Number(every.months) || 0);
  const days = Number(every.days) || 0;
  return { months, days };
}

function formatEvery(every, t) {
  const norm = normalizeEvery(every);
  if (!norm) return '—';
  if (norm.months)
    return t('schedule.everyMonth', { count: norm.months });
  if (norm.days) return t('schedule.everyDay', { count: norm.days });
  return '—';
}

function nextOccurrence(anchorDate, every) {
  const datePart = String(anchorDate ?? '').slice(0, 10);
  const anchor = new Date(`${datePart}T00:00:00`);
  const norm = normalizeEvery(every);
  if (Number.isNaN(anchor.getTime()) || !norm) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (anchor >= today) return anchor;
  if (norm.months) {
    const monthsSince = (today.getFullYear() - anchor.getFullYear()) * 12 +
      today.getMonth() - anchor.getMonth();
    const occurrence = (index) => {
      const next = new Date(anchor.getFullYear(), anchor.getMonth() + index * norm.months, 1);
      const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
      next.setDate(Math.min(anchor.getDate(), lastDay));
      return next;
    };
    const index = Math.floor(monthsSince / norm.months);
    const next = occurrence(index);
    if (next < today) return occurrence(index + 1);
    return next;
  }
  if (norm.days) {
    const step = norm.days * 86_400_000;
    const diff = today.getTime() - anchor.getTime();
    return new Date(anchor.getTime() + Math.ceil(diff / step) * step);
  }
  return null;
}

function targetLabel(assignment, t) {
  if (assignment.groupId)
    return t('schedule.targetGroup', { name: assignment.groupName });
  return t('schedule.targetStudent', {
    student: assignment.studentName,
    group: assignment.studentGroupName,
  });
}

function AssignmentForm({ assignment, teachers, intervals, groups, onDone }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const isEdit = assignment !== null;

  const [teacherId, setTeacherId] = useState(assignment?.teacherId ?? '');
  const [intervalId, setIntervalId] = useState(assignment?.intervalId ?? '');
  const [anchorDate, setAnchorDate] = useState(assignment?.anchorDate ?? toIsoDate(new Date()));
  const [name, setName] = useState(assignment?.name ?? '');

  // Individual targeting: search a student, then pick one of their open
  // memberships (which group's membership the schedule attaches to).
  const [targetKind, setTargetKind] = useState('group');
  const [groupId, setGroupId] = useState('');
  const [studentSearch, setStudentSearch] = useState('');
  const debouncedSearch = useDebouncedValue(studentSearch, 250);
  const [pickedStudent, setPickedStudent] = useState(null);
  const [membershipId, setMembershipId] = useState('');

  const studentQuery = useQuery({
    queryKey: ['students', 'schedule-target', debouncedSearch],
    queryFn: () => listStudents({ search: debouncedSearch, pageSize: 10, sort: 'name' }),
    enabled: !isEdit && targetKind === 'member' && debouncedSearch.trim() !== '',
  });
  const membershipQuery = useQuery({
    queryKey: ['schedule-memberships', pickedStudent?.id],
    queryFn: () => listStudentMemberships(pickedStudent.id),
    enabled: !isEdit && pickedStudent !== null,
  });
  const memberships = membershipQuery.data ?? [];
  // A student with exactly one open membership does not need a picker: the
  // schedule simply attaches to that membership.
  const effectiveMembershipId =
    membershipId || (memberships.length === 1 ? memberships[0].membershipId : '');

  const save = useMutation({
    mutationFn: () => {
      if (isEdit) {
        return updateAssignment(assignment.id, {
          teacherId,
          intervalId,
          anchorDate,
          name: name.trim() === '' ? null : name.trim(),
        });
      }
      const body = {
        teacherId,
        intervalId,
        anchorDate,
        name: name.trim() === '' ? null : name.trim(),
      };
      if (targetKind === 'group') body.groupId = groupId;
      else body.membershipId = effectiveMembershipId;
      return createAssignment(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assignments'] });
      if (isEdit) onDone();
      else {
        setName('');
        setGroupId('');
        setPickedStudent(null);
        setMembershipId('');
        setStudentSearch('');
      }
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  function pickStudent(student) {
    setPickedStudent(student);
    setMembershipId('');
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor="assignment-teacher">{t('schedule.form.teacher')}</label>
      <select
        id="assignment-teacher"
        value={teacherId}
        onChange={(event) => setTeacherId(event.target.value)}
        disabled={save.isPending}
      >
        <option value="">{t('schedule.form.chooseTeacher')}</option>
        {teachers
          .filter((teacher) => !teacher.archivedAt)
          .map((teacher) => (
            <option key={teacher.id} value={teacher.id}>
              {teacher.fullName}
            </option>
          ))}
      </select>

      <label htmlFor="assignment-interval">{t('schedule.form.every')}</label>
      <select
        id="assignment-interval"
        value={intervalId}
        onChange={(event) => setIntervalId(event.target.value)}
        disabled={save.isPending}
      >
        <option value="">{t('schedule.form.chooseInterval')}</option>
        {intervals
          .filter((interval) => !interval.archivedAt)
          .map((interval) => (
            <option key={interval.id} value={interval.id}>
              {interval.name} ({formatEvery(interval.every, t)})
            </option>
          ))}
      </select>

      <label htmlFor="assignment-anchor">{t('schedule.form.anchor')}</label>
      <JalaliDatePicker
        id="assignment-anchor"
        value={anchorDate}
        onChange={setAnchorDate}
        disabled={save.isPending}
      />

      <label htmlFor="assignment-name">
        {t('schedule.form.nameOptional')}
      </label>
      <input
        id="assignment-name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={100}
        placeholder={t('schedule.form.namePlaceholder')}
        autoComplete="off"
        disabled={save.isPending}
      />

      {isEdit ? (
        <p className="hint">
          {t('schedule.form.targetEditHint', {
            target: targetLabel(assignment, t),
          })}
        </p>
      ) : (
        <>
          <label>{t('schedule.form.target')}</label>
          <div className="row">
            <label className="hint">
              <input
                type="radio"
                name="target-kind"
                checked={targetKind === 'group'}
                onChange={() => setTargetKind('group')}
                disabled={save.isPending}
              />{' '}
              {t('schedule.form.wholeGroup')}
            </label>
            <label className="hint">
              <input
                type="radio"
                name="target-kind"
                checked={targetKind === 'member'}
                onChange={() => setTargetKind('member')}
                disabled={save.isPending}
              />{' '}
              {t('schedule.form.oneStudent')}
            </label>
          </div>

          {targetKind === 'group' ? (
            <>
              <label htmlFor="assignment-group">
                {t('schedule.form.group')}
              </label>
              <select
                id="assignment-group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
                disabled={save.isPending}
              >
                <option value="">{t('schedule.form.chooseGroup')}</option>
                {groups
                  .filter((group) => !group.archivedAt)
                  .map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.path || group.name}
                    </option>
                  ))}
              </select>
            </>
          ) : (
            <>
              <label htmlFor="assignment-student">
                {t('schedule.form.student')}
              </label>
              {pickedStudent === null ? (
                <>
                  <input
                    id="assignment-student"
                    type="search"
                    className="search"
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder={t('schedule.form.searchPlaceholder')}
                    autoComplete="off"
                    disabled={save.isPending}
                  />
                  <ul className="plain-list">
                    {studentQuery.data?.students.map((student) => (
                      <li key={student.id}>
                        {student.fullName}{' '}
                        <code className="hint">{student.studentCode}</code>{' '}
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => pickStudent(student)}
                          disabled={save.isPending}
                        >
                          {t('schedule.form.choose')}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <div className="row">
                  <span>
                    {pickedStudent.fullName}{' '}
                    {memberships.length > 1 && (
                      <select
                        aria-label={t('schedule.form.membershipLabel')}
                        value={membershipId}
                        onChange={(event) => setMembershipId(event.target.value)}
                        disabled={save.isPending}
                      >
                        <option value="">{t('schedule.form.whichGroup')}</option>
                        {memberships.map((membership) => (
                          <option key={membership.membershipId} value={membership.membershipId}>
                            {membership.groupName}
                          </option>
                        ))}
                      </select>
                    )}
                  </span>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => {
                      setPickedStudent(null);
                      setMembershipId('');
                    }}
                    disabled={save.isPending}
                  >
                    {t('schedule.form.change')}
                  </button>
                </div>
              )}
              {pickedStudent !== null && memberships.length === 0 && (
                <p className="hint">{t('schedule.form.noLiveGroup')}</p>
              )}
            </>
          )}
        </>
      )}

      <div className="row">
        <button type="submit" disabled={save.isPending}>
          {save.isPending
            ? t('common:actions.saving')
            : isEdit
              ? t('schedule.form.save')
              : t('schedule.form.add')}
        </button>
        {isEdit && (
          <button type="button" onClick={onDone} disabled={save.isPending}>
            {t('common:actions.cancel')}
          </button>
        )}
      </div>
      {save.isError && (
        <p className="error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
      {save.isSuccess && !isEdit && (
        <p className="success" role="status">
          {t('schedule.form.added')}
        </p>
      )}
    </form>
  );
}

function IntervalsManager({ intervals }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [count, setCount] = useState(7);
  const [unit, setUnit] = useState('days');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['intervals'] });
  const save = useMutation({
    mutationFn: () =>
      createInterval(
        unit === 'months'
          ? { name, everyMonths: count }
          : { name, everyDays: count },
      ),
    onSuccess: () => {
      invalidate();
      setName('');
    },
  });
  const archive = useMutation({
    mutationFn: (id) => archiveInterval(id),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (id) => updateInterval(id, { archived: false }),
    onSuccess: invalidate,
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <section className="section-card">
      <h2>{t('schedule.intervals.title')}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">{t('schedule.intervals.colName')}</th>
              <th scope="col">{t('schedule.intervals.colEvery')}</th>
              <th scope="col">{t('common:table.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {intervals.map((interval) => (
              <tr key={interval.id} className={interval.archivedAt ? 'stale' : undefined}>
                <th scope="row">{interval.name}</th>
                <td>{formatEvery(interval.every, t)}</td>
                <td className="actions">
                  {interval.archivedAt ? (
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => restore.mutate(interval.id)}
                      disabled={archive.isPending || restore.isPending}
                    >
                      {t('common:actions.restore')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="danger"
                      onClick={() => archive.mutate(interval.id)}
                      disabled={archive.isPending || restore.isPending}
                    >
                      {t('common:actions.archive')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CreateSection title={t('schedule.intervals.add')}>
      <form onSubmit={handleSubmit} className="edit-form">
        <label htmlFor="interval-name">
          {t('schedule.intervals.newName')}
        </label>
        <input
          id="interval-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={60}
          placeholder={t('schedule.intervals.namePlaceholder')}
          autoComplete="off"
          disabled={save.isPending}
        />
        <label htmlFor="interval-count">
          {t('schedule.intervals.everyLabel')}
        </label>
        <div className="row">
          <input
            id="interval-count"
            type="number"
            min={1}
            max={unit === 'months' ? 24 : 365}
            value={count}
            onChange={(event) => setCount(Number(event.target.value))}
            disabled={save.isPending}
          />
          <select
            aria-label={t('schedule.intervals.unitLabel')}
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
            disabled={save.isPending}
          >
            <option value="days">{t('schedule.intervals.unitDays')}</option>
            <option value="months">{t('schedule.intervals.unitMonths')}</option>
          </select>
          <button type="submit" disabled={save.isPending}>
            {save.isPending
              ? t('schedule.intervals.adding')
              : t('schedule.intervals.add')}
          </button>
        </div>
        {save.isError && (
          <p className="error">{errorMessage(save.error)}</p>
        )}
      </form>
      </CreateSection>
    </section>
  );
}

function SchedulePage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const canManage = can('schedule.manage');
  const canPickTeachers = can('teachers.view');
  const canPickGroups = can('students.view');
  const canUseForm = canManage && canPickTeachers && canPickGroups;

  const assignmentsQuery = useQuery({
    queryKey: ['assignments', { includeArchived }],
    queryFn: () => listAssignments({ includeArchived }),
  });
  const intervalsQuery = useQuery({
    queryKey: ['intervals', { includeArchived: true }],
    queryFn: () => listIntervals({ includeArchived: true }),
  });
  const teachersQuery = useQuery({
    queryKey: ['teachers', { search: '', includeArchived: true }],
    queryFn: () => listTeachers({ includeArchived: true }),
    enabled: canUseForm,
  });
  const groupsQuery = useQuery({
    queryKey: ['groups', { includeArchived: true }],
    queryFn: () => listGroups({ includeArchived: true }),
    enabled: canUseForm,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['assignments'] });
  const archive = useMutation({
    mutationFn: (id) => archiveAssignment(id),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (assignment) =>
      updateAssignment(assignment.id, { archived: false }),
    onSuccess: invalidate,
  });
  const actionError = archive.error ?? restore.error;
  function runAction(mutation, value) {
    archive.reset();
    restore.reset();
    mutation.mutate(value);
  }

  const assignments = assignmentsQuery.data ?? [];
  const intervals = intervalsQuery.data ?? [];

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('schedule.title')}</h1>
          <p className="hint">{t('schedule.hint')}</p>
        </div>
      </div>

      {canUseForm && editingId === null && (
        <CreateSection title={t('schedule.addTitle')}>
          <MultiAssignmentForm
            assignment={null}
            teachers={teachersQuery.data ?? []}
            intervals={intervals}
            groups={groupsQuery.data ?? []}
            onDone={() => {}}
          />
        </CreateSection>
      )}

      <section className="section-card">
        <div className="toolbar">
          <label className="hint">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t('schedule.includeArchived')}
          </label>
        </div>

        {assignmentsQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {assignmentsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(assignmentsQuery.error)}
          </p>
        )}
        {actionError && (
          <p className="error" role="alert">{errorMessage(actionError)}</p>
        )}
        {assignments.length === 0 && !assignmentsQuery.isPending && (
          <EmptyState
            title={t('schedule.emptyTitle')}
            description={
              canUseForm
                ? t('schedule.emptyCanForm')
                : t('schedule.emptyNoForm')
            }
          />
        )}

        {assignments.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('common:table.code')}</th>
                  <th scope="col">{t('schedule.colName')}</th>
                  <th scope="col">{t('schedule.colTeacher')}</th>
                  <th scope="col">{t('schedule.colTarget')}</th>
                  <th scope="col">{t('schedule.colEvery')}</th>
                  <th scope="col">{t('schedule.colAnchor')}</th>
                  <th scope="col">{t('schedule.colNext')}</th>
                  {canManage && (
                    <th scope="col">{t('common:table.actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => {
                  const next = nextOccurrence(assignment.anchorDate, assignment.every);
                  return editingId === assignment.id ? (
                    <tr key={assignment.id}>
                      <td colSpan={canManage ? 8 : 7}>
                        <AssignmentForm
                          assignment={assignment}
                          teachers={teachersQuery.data ?? []}
                          intervals={intervals}
                          groups={groupsQuery.data ?? []}
                          onDone={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={assignment.id}
                      className={assignment.archivedAt ? 'stale' : undefined}
                    >
                      <td>
                        <code>{assignment.code}</code>
                      </td>
                      <td>{assignment.name ?? '—'}</td>
                      <td>{assignment.teacherName}</td>
                      <td>{targetLabel(assignment, t)}</td>
                      <td>
                        {assignment.intervalName}{' '}
                        <span className="hint">
                          ({formatEvery(assignment.every, t)})
                        </span>
                      </td>
                      <td>{formatIsoDate(assignment.anchorDate)}</td>
                      <td>
                        {next && !assignment.archivedAt
                          ? formatIsoDate(toIsoDate(next))
                          : '—'}
                      </td>
                      {canManage && (
                        <td className="actions">
                          {assignment.archivedAt ? (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() => runAction(restore, assignment)}
                              disabled={archive.isPending || restore.isPending}
                            >
                              {t('common:actions.restore')}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="quiet"
                                onClick={() => setEditingId(assignment.id)}
                                disabled={archive.isPending || restore.isPending}
                              >
                                {t('common:actions.edit')}
                              </button>{' '}
                              <button
                                type="button"
                                className="danger"
                                onClick={() => runAction(archive, assignment.id)}
                                disabled={archive.isPending || restore.isPending}
                              >
                                {t('common:actions.archive')}
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canManage && intervals.length > 0 && (
        <IntervalsManager intervals={intervals} />
      )}
    </main>
  );
}

export default SchedulePage;
