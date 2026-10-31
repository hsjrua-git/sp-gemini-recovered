import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createAccount,
  deactivateAccount,
  listAccounts,
  listMappings,
  updateAccount,
  updateMapping,
} from '../api/accountingAdmin.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { toLatinDigits } from '../lib/locale.js';
import HierarchySelect from '../components/HierarchySelect.jsx';
import { branchIds } from '../lib/hierarchy.js';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];

// Accounting setup: the chart of accounts (deactivate-not-delete; system
// accounts keep their code and type) and the cafe→journal auto-posting map.
function AccountForm({ initial, onDone, accounts }) {
  const { t } = useTranslation(['accountingAdmin', 'common']);
  const queryClient = useQueryClient();
  const [code, setCode] = useState(initial?.code ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [type, setType] = useState(initial?.type ?? 'expense');
  const [parentId, setParentId] = useState(initial?.parentId ?? '');

  const save = useMutation({
    mutationFn: () =>
      initial
        ? updateAccount(initial.id, {
            name,
            parentId: parentId || null,
          })
        : createAccount({ code, name, type, parentId: parentId || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-accounts'] });
      onDone();
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      {!initial && (
        <>
          <label htmlFor={`account-code-${initial ? initial.id : 'new'}`}>
            {t('accounts.code')}
          </label>
          <input
            id={`account-code-${initial ? initial.id : 'new'}`}
            value={code}
            onChange={(event) => setCode(toLatinDigits(event.target.value).trim())}
            maxLength={20}
            disabled={save.isPending}
          />
          <label htmlFor={`account-type-${initial ? initial.id : 'new'}`}>
            {t('accounts.type')}
          </label>
          <select
            id={`account-type-${initial ? initial.id : 'new'}`}
            value={type}
            onChange={(event) => setType(event.target.value)}
            disabled={save.isPending}
          >
            {TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`types.${value}`)}
              </option>
            ))}
          </select>
        </>
      )}
      <label htmlFor={`account-name-${initial ? initial.id : 'new'}`}>
        {t('accounts.name')}
      </label>
      <input
        id={`account-name-${initial ? initial.id : 'new'}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={120}
        disabled={save.isPending}
      />
      <label htmlFor={`account-parent-${initial ? initial.id : 'new'}`}>
        {t('accounts.parent')}
      </label>
      <HierarchySelect
        id={`account-parent-${initial ? initial.id : 'new'}`}
        items={accounts.filter(account => !initial || !branchIds(accounts, [initial.id]).includes(account.id)).map(account => ({ ...account, name: `${account.code} · ${account.name}` }))}
        value={parentId}
        onChange={setParentId}
        emptyLabel={t('accounts.noParent')}
        disabled={save.isPending}
      />
      <div className="row">
        <button
          type="submit"
          disabled={
            save.isPending || name.trim() === '' || (!initial && code.trim() === '')
          }
        >
          {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
        </button>
        <button type="button" onClick={onDone} disabled={save.isPending}>
          {t('common:actions.cancel')}
        </button>
      </div>
      {save.isError && (
        <p className="error" role="alert">
          {errorMessage(save.error)}
        </p>
      )}
    </form>
  );
}

function MappingRow({ mapping, accounts, canManage }) {
  const { t } = useTranslation(['accountingAdmin', 'common']);
  const queryClient = useQueryClient();
  const [debitAccountId, setDebitAccountId] = useState(mapping.debitAccountId);
  const [creditAccountId, setCreditAccountId] = useState(mapping.creditAccountId);
  const [isActive, setIsActive] = useState(mapping.isActive);

  const save = useMutation({
    mutationFn: () =>
      updateMapping(mapping.event, {
        debitAccountId,
        creditAccountId,
        isActive,
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['accounting-mappings'] }),
  });

  return (
    <tr className={mapping.isActive ? undefined : 'stale'}>
      <th scope="row">{t(`mappings.events.${mapping.event}`)}</th>
      {canManage ? (
        <>
          <td>
            <select
              aria-label={t('mappings.debitAccount')}
              value={debitAccountId}
              onChange={(event) => setDebitAccountId(event.target.value)}
              disabled={save.isPending}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </td>
          <td>
            <select
              aria-label={t('mappings.creditAccount')}
              value={creditAccountId}
              onChange={(event) => setCreditAccountId(event.target.value)}
              disabled={save.isPending}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
          </td>
          <td>
            <label className="hint">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(event) => setIsActive(event.target.checked)}
                disabled={save.isPending}
              />{' '}
              {t('mappings.active')}
            </label>
          </td>
          <td className="actions">
            <button
              type="button"
              className="quiet"
              onClick={() => save.mutate()}
              disabled={save.isPending}
            >
              {save.isPending ? t('common:actions.saving') : t('common:actions.save')}
            </button>
            {save.isSuccess && (
              <span className="success" role="status"> {t('mappings.saved')}</span>
            )}
            {save.isError && (
              <p className="error" role="alert">{errorMessage(save.error)}</p>
            )}
          </td>
        </>
      ) : (
        <>
          <td><code>{mapping.debitCode}</code> {mapping.debitName}</td>
          <td><code>{mapping.creditCode}</code> {mapping.creditName}</td>
          <td>{mapping.isActive ? t('mappings.active') : '—'}</td>
          <td />
        </>
      )}
    </tr>
  );
}

function AccountingAccountsPage() {
  const { can } = useAuth();
  const { t } = useTranslation(['accountingAdmin', 'common']);
  const queryClient = useQueryClient();
  const canManage = can('accounting.manage');
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const accountsQuery = useQuery({
    queryKey: ['accounting-accounts', { includeInactive }],
    queryFn: () => listAccounts({ includeInactive }),
  });
  const mappingsQuery = useQuery({
    queryKey: ['accounting-mappings'],
    queryFn: listMappings,
  });
  const accounts = accountsQuery.data ?? [];
  const mappings = mappingsQuery.data ?? [];

  const deactivate = useMutation({
    mutationFn: deactivateAccount,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['accounting-accounts'] }),
  });

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('accounts.title')}</h1>
          <p className="hint">{t('accounts.hint')}</p>
        </div>
        {canManage && (
          <div className="page-head-actions">
            <label className="hint">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
              />{' '}
              {t('accounts.status')}
            </label>
          </div>
        )}
      </div>

      <section className="section-card">
        {accountsQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
        {accountsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(accountsQuery.error)}
          </p>
        )}
        {accounts.length === 0 && !accountsQuery.isPending && (
          <p className="hint">{t('accounts.empty')}</p>
        )}
        {accounts.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('accounts.code')}</th>
                <th scope="col">{t('accounts.name')}</th>
                <th scope="col">{t('accounts.type')}</th>
                <th scope="col">{t('accounts.status')}</th>
                {canManage && <th scope="col">{t('periods.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) =>
                editingId === account.id ? (
                  <tr key={account.id}>
                    <td colSpan={canManage ? 5 : 4}>
                      <AccountForm
                        initial={account}
                        accounts={accounts}
                        onDone={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={account.id}
                    className={account.isActive ? undefined : 'stale'}
                  >
                    <th scope="row">
                      <code>{account.code}</code>
                    </th>
                    <td>
                      {account.name}
                      {account.isSystem && (
                        <span className="badge"> {t('accounts.system')}</span>
                      )}
                    </td>
                    <td>{t(`types.${account.type}`)}</td>
                    <td>{account.isActive ? '✓' : '—'}</td>
                    {canManage && (
                      <td className="actions">
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => setEditingId(account.id)}
                          disabled={deactivate.isPending}
                        >
                          {t('accounts.edit')}
                        </button>
                        {account.isActive && (
                          <button
                            type="button"
                            className="danger"
                            onClick={() => deactivate.mutate(account.id)}
                            disabled={deactivate.isPending || account.isSystem}
                          >
                            ✕
                          </button>
                        )}
                        {deactivate.isError &&
                          deactivate.variables === account.id && (
                            <p className="error" role="alert">
                              {errorMessage(deactivate.error)}
                            </p>
                          )}
                      </td>
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
          </div>
        )}
        {canManage &&
          (creating ? (
            <AccountForm accounts={accounts} onDone={() => setCreating(false)} />
          ) : (
            <button type="button" onClick={() => setCreating(true)}>
              {t('accounts.newAccount')}
            </button>
          ))}
      </section>

      <section className="section-card">
        <h2>{t('mappings.title')}</h2>
        <p className="hint">{t('mappings.hint')}</p>
        {mappingsQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
        {mappingsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(mappingsQuery.error)}
          </p>
        )}
        {mappings.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t('mappings.event')}</th>
                  <th scope="col">{t('mappings.debitAccount')}</th>
                  <th scope="col">{t('mappings.creditAccount')}</th>
                  <th scope="col">{t('mappings.active')}</th>
                  {canManage && <th scope="col">{t('periods.actions')}</th>}
                </tr>
              </thead>
              <tbody>
                {mappings.map((mapping) => (
                  <MappingRow
                    key={mapping.id}
                    mapping={mapping}
                    accounts={accounts}
                    canManage={canManage}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default AccountingAccountsPage;
