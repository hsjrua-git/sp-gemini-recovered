import { useMemo, useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  archiveGroup,
  createGroup,
  listGroupMembers,
  listGroups,
  updateGroup,
  updateGroupMembers,
} from '../api/groups.js';
import { listStudents } from '../api/students.js';
import { formatIsoDate } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { errorMessage } from '../i18n/errors.js';
import HierarchySelect from '../components/HierarchySelect.jsx';
import { branchIds, hierarchy } from '../lib/hierarchy.js';

function MemberPanel({ group, onClose }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const debounced = useDebouncedValue(search, 250);

  const membersQuery = useQuery({
    queryKey: ['group-members', group.id],
    queryFn: () => listGroupMembers(group.id),
  });
  const searchQuery = useQuery({
    queryKey: ['students', 'group-search', debounced],
    queryFn: () => listStudents({ search: debounced, pageSize: 20, sort: 'name' }),
    enabled: debounced.trim() !== '',
  });

  const change = useMutation({
    mutationFn: (payload) => updateGroupMembers(group.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['group-members', group.id] });
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  const members = membersQuery.data ?? [];
  const openMembers = members.filter((student) => !student.leftOn);
  const pastMembers = members.filter((student) => student.leftOn);
  // Only open members are excluded from the "add" picker, so a student who
  // left can be re-added (which starts a new membership row).
  const memberIds = new Set(openMembers.map((s) => s.id));

  return (
    <section className="group-members section-card">
      <div className="toolbar">
        <h2>{t('groups.membersTitle', { name: group.name })}</h2>
        <button type="button" onClick={onClose}>
          {t('common:actions.done')}
        </button>
      </div>

      <div className="two-col">
        <div>
          <h3>{t('groups.inThisGroup')}</h3>
          {membersQuery.isPending && (
            <p className="hint">{t('common:status.loading')}</p>
          )}
          {membersQuery.data?.length === 0 && (
            <p className="hint">{t('groups.noStudents')}</p>
          )}
          <ul className="plain-list">
            {openMembers.map((student) => (
              <li key={student.id}>
                {student.fullName}{' '}
                <code className="hint">{student.studentCode}</code>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => change.mutate({ remove: [student.id] })}
                  disabled={change.isPending}
                >
                  {t('groups.remove')}
                </button>
              </li>
            ))}
          </ul>
          {pastMembers.length > 0 && (
            <>
              <h3>{t('groups.pastMembers')}</h3>
              <ul className="plain-list">
                {pastMembers.map((student) => (
                  <li key={student.membershipId ?? `${student.id}-${student.joinedOn}-${student.leftOn}`} className="hint">
                    {student.fullName}{' '}
                    <span className="hint">
                      ({formatIsoDate(student.joinedOn)} →{' '}
                      {formatIsoDate(student.leftOn)})
                    </span>
                <button
                  type="button"
                  className="quiet"
                  onClick={() => change.mutate({ add: [student.id] })}
                  disabled={change.isPending}
                >
                  {t('groups.reAdd')}
                </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <div>
          <h3>{t('groups.addStudents')}</h3>
          <input
            type="search"
            className="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('groups.searchPlaceholder')}
            aria-label={t('groups.searchLabel')}
          />
          <ul className="plain-list">
            {searchQuery.data?.students
              .filter((student) => !memberIds.has(student.id))
              .map((student) => (
                <li key={student.id}>
                  {student.fullName}{' '}
                  <code className="hint">{student.studentCode}</code>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => change.mutate({ add: [student.id] })}
                    disabled={change.isPending}
                  >
                    {t('common:actions.add')}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      </div>
      {change.isError && (
        <p className="error" role="alert">
          {errorMessage(change.error)}
        </p>
      )}
    </section>
  );
}

function NewGroupForm({ groups }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');

  const create = useMutation({
    mutationFn: createGroup,
    onSuccess: () => {
      setName('');
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    create.mutate({ name, parentId: parentId || null });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          {t('groups.name')}
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <label>
          {t('groups.inside')}
          <HierarchySelect items={groups} value={parentId} onChange={setParentId} emptyLabel={t('groups.topLevel')} />
        </label>
      </div>
      <button type="submit" disabled={create.isPending || name.trim() === ''}>
        {create.isPending ? t('groups.adding') : t('groups.submit')}
      </button>
      {create.isError && (
        <p className="error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
    </form>
  );
}

function GroupRow({ group, groups, canManage, canAssign, onManage, expanded, onToggle }) {
  const { t } = useTranslation(['admin', 'common', 'workflows']);
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [moving, setMoving] = useState(false);
  const [parentId, setParentId] = useState(group.parentId ?? '');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['groups'] });

  const update = useMutation({
    mutationFn: (fields) => updateGroup(group.id, fields),
    onSuccess: () => {
      setRenaming(false);
      setMoving(false);
      invalidate();
    },
  });
  const archive = useMutation({
    mutationFn: () => archiveGroup(group.id),
    onSuccess: invalidate,
  });

  return (
    <tr>
      <td>
        <div className="group-name">
          {group.hasChildren && <button type="button" className="quiet tree-disclosure" aria-expanded={expanded} aria-label={t('workflows:tree.expand', { name: group.name })} onClick={onToggle}><span aria-hidden="true">⌄</span></button>}
          <span>
          {renaming ? (
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={60}
              aria-label={t('groups.renameLabel', { name: group.name })}
            />
          ) : (
            group.name
          )}
          {group.depth > 0 && <span className="hierarchy-context">{group.path.split(' / ').slice(0, -1).join(' / ')}</span>}
          </span>
        </div>
      </td>
      <td>{group.memberCount}</td>
      <td className="actions">
        {renaming ? (
          <>
            <button
              type="button"
              onClick={() => update.mutate({ name })}
              disabled={update.isPending}
            >
              {t('common:actions.save')}
            </button>
            <button type="button" onClick={() => setRenaming(false)}>
              {t('common:actions.cancel')}
            </button>
          </>
        ) : moving ? (
          <>
            <HierarchySelect
              items={groups.filter(candidate => !branchIds(groups, [group.id]).includes(candidate.id))}
              value={parentId}
              onChange={setParentId}
              emptyLabel={t('groups.topLevel')}
              aria-label={t('groups.moveLabel', { name: group.name })}
            />
            <button
              type="button"
              onClick={() => update.mutate({ parentId: parentId || null })}
              disabled={update.isPending}
            >
              {t('groups.move')}
            </button>
            <button type="button" onClick={() => setMoving(false)}>
              {t('common:actions.cancel')}
            </button>
          </>
        ) : (
          <>
            {canAssign && (
              <button type="button" onClick={() => onManage(group)}>
                {t('groups.members')}
              </button>
            )}
            {canManage && (
              <>
                <button type="button" onClick={() => setRenaming(true)}>
                  {t('groups.rename')}
                </button>
                <button type="button" onClick={() => setMoving(true)}>
                  {t('groups.move')}
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    if (
                      window.confirm(
                        t('groups.archiveConfirm', { name: group.name })
                      )
                    )
                      archive.mutate();
                  }}
                  disabled={archive.isPending}
                >
                  {t('common:actions.archive')}
                </button>
              </>
            )}
          </>
        )}
        {(update.isError || archive.isError) && (
          <p className="error" role="alert">
            {errorMessage(update.error ?? archive.error)}
          </p>
        )}
      </td>
    </tr>
  );
}

function GroupsPage() {
  const { t } = useTranslation(['admin', 'common', 'workflows']);
  const { can } = useAuth();
  const canManage = can('groups.manage');
  const canAssign = can('groups.assign');
  const [managing, setManaging] = useState(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState([]);

  const groupsQuery = useQuery({ queryKey: ['groups'], queryFn: () => listGroups() });
  const tree = useMemo(
    () => (groupsQuery.data ? hierarchy(groupsQuery.data) : []),
    [groupsQuery.data]
  );

  if (!canManage && !canAssign) {
    return (
      <main>
        <EmptyState
          title={t('groups.readOnlyTitle')}
          description={t('groups.readOnlyDescription')}
        />
      </main>
    );
  }

  return (
    <main className="wide">
      <h1>{t('groups.title')}</h1>
      <p className="hint">{t('groups.hint')}</p>

      {canManage && (
        <CreateSection title={t('groups.addTitle')}>
          <NewGroupForm groups={tree} />
        </CreateSection>
      )}

      <section className="section-card">
        <div className="home-section-head">
          <h2>{t('groups.listTitle')}</h2>
          <input type="search" className="search" aria-label={t('workflows:tree.search', { label: t('groups.title') })} placeholder={t('workflows:tree.search', { label: t('groups.title') })} value={search} onChange={event => setSearch(event.target.value)} />
        </div>
        {groupsQuery.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {groupsQuery.isError && (
          <p className="error">{errorMessage(groupsQuery.error)}</p>
        )}
        {groupsQuery.data && tree.length === 0 && (
          <p className="hint">{t('groups.empty')}</p>
        )}
        {tree.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('groups.colGroup')}</th>
                  <th>{t('groups.colMembers')}</th>
                  <th>{t('common:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {tree.filter(group => search.trim() ? group.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()) : !group.ancestorIds.some(id => collapsed.includes(id))).map((group) => (
                  <GroupRow
                    key={group.id}
                    group={group}
                    groups={tree}
                    canManage={canManage}
                    canAssign={canAssign}
                    onManage={setManaging}
                    expanded={!collapsed.includes(group.id)}
                    onToggle={() => setCollapsed(current => current.includes(group.id) ? current.filter(id => id !== group.id) : [...current, group.id])}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {managing && canAssign && (
        <MemberPanel group={managing} onClose={() => setManaging(null)} />
      )}
    </main>
  );
}

export default GroupsPage;
