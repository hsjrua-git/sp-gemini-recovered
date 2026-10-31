import { useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  archiveTeacher,
  createTeacher,
  listTeachers,
  updateTeacher,
} from '../api/teachers.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { formatIsoDate } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { errorMessage } from '../i18n/errors.js';

// A teacher's full identity record. Creation requires everything up front;
// editing and archiving follow the same pattern as students and groups.
function TeacherForm({ teacher, onDone }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const isEdit = teacher !== null;
  const [fullName, setFullName] = useState(teacher?.fullName ?? '');
  const [birthDate, setBirthDate] = useState(teacher?.birthDate ?? '');
  const [nationalId, setNationalId] = useState(teacher?.nationalId ?? '');

  const save = useMutation({
    mutationFn: () =>
      isEdit
        ? updateTeacher(teacher.id, {
            fullName,
            birthDate,
            nationalId,
          })
        : createTeacher({ fullName, birthDate, nationalId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teachers'] });
      if (isEdit) onDone();
      else {
        setFullName('');
        setBirthDate('');
        setNationalId('');
      }
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor={isEdit ? `teacher-name-${teacher.id}` : 'teacher-name'}>
        {t('teachers.fullName')}
      </label>
      <input
        id={isEdit ? `teacher-name-${teacher.id}` : 'teacher-name'}
        value={fullName}
        onChange={(event) => setFullName(event.target.value)}
        maxLength={100}
        autoComplete="off"
        disabled={save.isPending}
      />

      <label htmlFor={isEdit ? `teacher-birth-${teacher.id}` : 'teacher-birth'}>
        {t('teachers.birthDate')}
      </label>
      <JalaliDatePicker
        id={isEdit ? `teacher-birth-${teacher.id}` : 'teacher-birth'}
        value={birthDate}
        onChange={setBirthDate}
        disabled={save.isPending}
      />

      <label htmlFor={isEdit ? `teacher-nid-${teacher.id}` : 'teacher-nid'}>
        {t('teachers.nationalId')}
      </label>
      <input
        id={isEdit ? `teacher-nid-${teacher.id}` : 'teacher-nid'}
        value={nationalId}
        onChange={(event) => setNationalId(event.target.value)}
        inputMode="numeric"
        pattern="[0-9]{10}"
        maxLength={10}
        autoComplete="off"
        disabled={save.isPending}
      />

      <div className="row">
        <button type="submit" disabled={save.isPending}>
          {save.isPending
            ? t('common:actions.saving')
            : isEdit
              ? t('teachers.saveEdit')
              : t('teachers.addSubmit')}
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
          {t('teachers.added', { name: save.data.teacher.fullName })}
        </p>
      )}
    </form>
  );
}

function TeachersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const teachersQuery = useQuery({
    queryKey: ['teachers', { search: debounced, includeArchived }],
    queryFn: () => listTeachers({ search: debounced, includeArchived }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['teachers'] });
  const archive = useMutation({
    mutationFn: (id) => archiveTeacher(id),
    onSuccess: invalidate,
  });
  const restore = useMutation({
    mutationFn: (teacher) => updateTeacher(teacher.id, { archived: false }),
    onSuccess: invalidate,
  });
  const change = archive.isPending || restore.isPending;

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('teachers.title')}</h1>
          <p className="hint">{t('teachers.hint')}</p>
        </div>
      </div>

      {can('teachers.manage') && editingId === null && (
        <CreateSection title={t('teachers.addTitle')}>
          <TeacherForm teacher={null} onDone={() => {}} />
        </CreateSection>
      )}

      <section className="section-card">
        <div className="toolbar">
          <input
            type="search"
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('teachers.searchPlaceholder')}
            aria-label={t('teachers.searchLabel')}
          />
          <label className="hint">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(event) => setIncludeArchived(event.target.checked)}
            />
            {t('teachers.includeArchived')}
          </label>
        </div>

        {teachersQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {teachersQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(teachersQuery.error)}
          </p>
        )}
        {teachersQuery.data?.length === 0 && (
          <EmptyState
            title={t('teachers.emptyTitle')}
            description={t('teachers.emptyDescription')}
          />
        )}

        {teachersQuery.data && teachersQuery.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('common:table.code')}</th>
                  <th scope="col">{t('teachers.colFullName')}</th>
                  <th scope="col">{t('teachers.colBirthDate')}</th>
                  <th scope="col">{t('teachers.colNationalId')}</th>
                  {can('teachers.manage') && (
                    <th scope="col">{t('common:table.actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {teachersQuery.data.map((teacher) =>
                  editingId === teacher.id ? (
                    <tr key={teacher.id}>
                      <td colSpan={can('teachers.manage') ? 5 : 4}>
                        <TeacherForm
                          teacher={teacher}
                          onDone={() => setEditingId(null)}
                        />
                      </td>
                    </tr>
                  ) : (
                    <tr
                      key={teacher.id}
                      className={teacher.archivedAt ? 'stale' : undefined}
                    >
                      <td>
                        <code>{teacher.code}</code>
                      </td>
                      <th scope="row">{teacher.fullName}</th>
                      <td>
                        {teacher.birthDate ? formatIsoDate(teacher.birthDate) : '—'}
                      </td>
                      <td>{teacher.nationalId}</td>
                      {can('teachers.manage') && (
                        <td className="actions">
                          {teacher.archivedAt ? (
                            <button
                              type="button"
                              className="quiet"
                              disabled={change}
                              onClick={() => restore.mutate(teacher)}
                            >
                              {t('common:actions.restore')}
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                className="quiet"
                                disabled={change}
                                onClick={() => setEditingId(teacher.id)}
                              >
                                {t('common:actions.edit')}
                              </button>{' '}
                              <button
                                type="button"
                                className="danger"
                                disabled={change}
                                onClick={() => archive.mutate(teacher.id)}
                              >
                                {t('common:actions.archive')}
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default TeachersPage;
