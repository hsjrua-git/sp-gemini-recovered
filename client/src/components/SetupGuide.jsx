import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { listGroups } from '../api/groups.js';
import { listStudents } from '../api/students.js';
import { listTeachers } from '../api/teachers.js';
import { listParameters } from '../api/parameters.js';
import { listAssignments, listIntervals } from '../api/schedule.js';
import { listSessions } from '../api/sessions.js';
import { errorMessage } from '../i18n/errors.js';

const active = data => data.some(item => !item.archivedAt);
const STEPS = [
  { id: 'students', permission: 'students.view', to: '/students', queryKey: ['students', 'setup'], queryFn: () => listStudents({ pageSize: 1 }), ready: data => data.total > 0 },
  { id: 'members', permission: 'students.view', to: '/groups', queryKey: ['groups'], queryFn: listGroups, ready: data => data.some(group => !group.archivedAt && group.memberCount > 0) },
  { id: 'teachers', permission: 'teachers.view', to: '/teachers', queryKey: ['teachers', 'setup'], queryFn: () => listTeachers({}), ready: active },
  { id: 'parameters', permission: 'parameters.view', to: '/parameters', queryKey: ['parameters'], queryFn: listParameters, ready: active },
  { id: 'intervals', permission: 'schedule.view', to: '/schedule', queryKey: ['intervals'], queryFn: listIntervals, ready: active },
  { id: 'assignments', permission: 'schedule.view', to: '/schedule', queryKey: ['assignments'], queryFn: listAssignments, ready: active },
  { id: 'sessions', permission: 'schedule.view', to: '/sessions', queryKey: ['sessions', 'setup'], queryFn: () => listSessions(), ready: data => data.sessions.length > 0 },
];
function Step({ step }) {
  const { t } = useTranslation('recovery');
  const { can } = useAuth();
  const permitted = can(step.permission);
  const query = useQuery({ queryKey: step.queryKey, queryFn: step.queryFn, enabled: permitted });
  const state = !permitted ? 'restricted' : query.isError ? 'unknown' : query.isPending ? 'checking' : step.ready(query.data) ? 'ready' : 'needed';
  return <li className="setup-step"><div><strong>{t(`setup.${step.id}`)}</strong><span className={`setup-status ${state}`}>{t(`setup.${state}`)}</span><p className="hint">{t(`setup.${step.id}Hint`)}</p></div>
    {query.isError && <p className="error" role="alert">{errorMessage(query.error)} <button onClick={() => query.refetch()}>{t('retry')}</button></p>}
    {permitted && <Link to={step.to}>{t('setup.open')} →</Link>}
  </li>;
}
export default function SetupGuide() {
  const { t } = useTranslation('recovery');
  const [open, setOpen] = useState(false);
  return <details className="section-card setup-guide" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><strong>{t('setup.title')}</strong><span className="hint">{t('setup.subtitle')}</span></summary>
    {open && <ol className="setup-steps">{STEPS.map(step => <Step key={step.id} step={step} />)}</ol>}
  </details>;
}
