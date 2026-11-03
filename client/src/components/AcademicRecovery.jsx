import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { request } from '../api/http.js';
import { errorMessage } from '../i18n/errors.js';

// One bounded, explicitly opened history list. Mutations invalidate all
// academic projections because archiving changes period/report membership.
export default function AcademicRecovery({ kind, sessionId, assignmentId }) {
  const { t } = useTranslation(['workflows', 'common']);
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['academic-recovery', kind, sessionId, assignmentId, kind === 'students' ? page : null],
    enabled: open,
    queryFn: async () => {
      if (kind === 'students') return request(`/api/students?archived=1&page=${page}&pageSize=25`);
      if (kind === 'periods') return request(`/api/periods?includeArchived=1${assignmentId ? `&assignmentId=${assignmentId}` : ''}`);
      return request(`/api/evaluations?includeArchived=1&sessionId=${sessionId}`);
    },
  });
  const mutation = useMutation({
    mutationFn: item => {
      if (kind === 'students') return request(`/api/students/${item.id}/restore`, { method: 'PUT' });
      if (kind === 'periods') return request(`/api/periods/${item.id}`, { method: 'PUT', body: JSON.stringify({ archived: !item.archivedAt }) });
      return request(`/api/evaluations/${item.id}/archive`, { method: 'PUT', body: JSON.stringify({ archived: !item.archivedAt, overrideReason: reason }) });
    },
    onSuccess: () => {
      setPage(1);
      for (const key of ['academic-recovery', 'students', 'student', 'students-all', 'all-students',
        'groups', 'group-members', 'student-groups', 'assignment-targets', 'schedule-memberships', 'task-targets',
        'evaluations', 'periods', 'results', 'export-cube', 'sessions', 'trends', 'dashboard', 'alerts']) {
        client.invalidateQueries({ queryKey: [key] });
      }
    },
  });
  const allItems = query.data?.[kind] ?? [];
  const items = kind === 'students' ? allItems : allItems.slice((page - 1) * 25, page * 25);
  const total = kind === 'students' ? query.data?.total ?? 0 : allItems.length;
  return <details className="panel" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{t(`lifecycle.${kind}`)}</summary>
    {kind === 'evaluations' && <label>{t('lifecycle.reason')}<input value={reason} onChange={event => setReason(event.target.value)} maxLength={300} /></label>}
    {query.isFetching && <p role="status">{t('common:status.loading')}</p>}
    {(query.error || mutation.error) && <p role="alert" className="error">{errorMessage(query.error || mutation.error)}</p>}
    {query.isSuccess && total === 0 && <p className="hint">{t('lifecycle.empty')}</p>}
    <ul className="plain-list">{items.map(item => <li key={item.id}>
      {item.fullName ?? (kind === 'periods'
        ? `${item.assignmentCode} · ${item.seq}`
        : `${item.sessionCode} · ${item.parameterName} · ${item.studentName ?? t('lifecycle.wholeGroup')}`)}{' '}
      <button type="button" disabled={mutation.isPending} onClick={() => mutation.mutate(item)}>
        {t(item.archivedAt || kind === 'students' ? 'common:actions.restore' : 'common:actions.archive')}
      </button>
    </li>)}</ul>
    {total > 25 && <div className="row">
      <button type="button" disabled={page === 1} onClick={() => setPage(page - 1)}>{t('lifecycle.previous')}</button>
      <span>{page} / {Math.ceil(total / 25)}</span>
      <button type="button" disabled={page * 25 >= total} onClick={() => setPage(page + 1)}>{t('lifecycle.next')}</button>
    </div>}
  </details>;
}
