import { useMemo, useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createJournalEntry,
  listAccounts,
  listJournalEntries,
  postEntry,
  voidEntry,
} from '../api/accountingJournal.js';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { startOfJalaliMonth, toLatinDigits } from '../lib/locale.js';
import { formatWhole as formatAmount } from '../lib/money.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { invalidateAccounting } from '../lib/accountingCache.js';

// The institution runs on the Jalali calendar, so the list opens on the
// first day of the current Jalali month; the wire range stays ISO.

function parseAmount(text) {
  const normalized = toLatinDigits(text).replace(/[\s,٬]/g, '');
  return /^\d+$/.test(normalized) ? Number(normalized) : null;
}

const STATUSES = ['draft', 'posted', 'voided'];

function NewEntryForm({ accounts }) {
  const { t } = useTranslation(['accountingJournal', 'common']);
  const queryClient = useQueryClient();
  const today = new Date();
  const [entryDate, setEntryDate] = useState(toIsoDate(today));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState([
    { accountId: '', side: 'debit', amount: '', lineMemo: '' },
    { accountId: '', side: 'credit', amount: '', lineMemo: '' },
  ]);

  const setLine = (index, patch) =>
    setLines((current) =>
      current.map((line, at) => (at === index ? { ...line, ...patch } : line))
    );
  const addLine = () =>
    setLines((current) => [
      ...current,
      { accountId: '', side: 'debit', amount: '', lineMemo: '' },
    ]);
  const removeLine = (index) =>
    setLines((current) => current.filter((_, at) => at !== index));

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const line of lines) {
      const amount = parseAmount(line.amount);
      if (amount === null) continue;
      if (line.side === 'debit') debit += amount;
      else credit += amount;
    }
    return { debit, credit };
  }, [lines]);
  const balanced = totals.debit > 0 && totals.debit === totals.credit;
  const difference = Math.abs(totals.debit - totals.credit);

  const create = useMutation({
    mutationFn: () =>
      createJournalEntry({
        entryDate,
        memo: memo.trim() === '' ? undefined : memo.trim(),
        lines: lines.map((line) => ({
          accountId: line.accountId,
          [line.side]: parseAmount(line.amount),
          memo: line.lineMemo.trim() === '' ? undefined : line.lineMemo.trim(),
        })),
      }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['accounting-journal'] });
      setMemo('');
      setLines([
        { accountId: '', side: 'debit', amount: '', lineMemo: '' },
        { accountId: '', side: 'credit', amount: '', lineMemo: '' },
      ]);
      setJustCreated(data.entry.entryNo);
    },
  });
  const [justCreated, setJustCreated] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <CreateSection title={t('newEntry')}>
      <form onSubmit={handleSubmit} className="edit-form">
        <div className="row">
          <label htmlFor="journal-entry-date">{t('entryDate')}</label>
          <JalaliDatePicker
            id="journal-entry-date"
            value={entryDate}
            onChange={setEntryDate}
            disabled={create.isPending}
          />
        </div>
        <label htmlFor="journal-entry-memo">{t('memo')}</label>
        <input
          id="journal-entry-memo"
          value={memo}
          onChange={(event) => setMemo(event.target.value)}
          maxLength={500}
          disabled={create.isPending}
        />

        <p className="hint">{t('lines')}</p>
        {lines.map((line, index) => (
          <div className="filter-row" key={index}>
            <select
              aria-label={t('account')}
              value={line.accountId}
              onChange={(event) => setLine(index, { accountId: event.target.value })}
              disabled={create.isPending}
            >
              <option value="">{t('account')}</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.code} · {account.name}
                </option>
              ))}
            </select>
            <span className="segmented" role="radiogroup" aria-label={t('side')}>
              <label>
                <input
                  type="radio"
                  name={`side-${index}`}
                  checked={line.side === 'debit'}
                  onChange={() => setLine(index, { side: 'debit' })}
                  disabled={create.isPending}
                />
                {t('debit')}
              </label>
              <label>
                <input
                  type="radio"
                  name={`side-${index}`}
                  checked={line.side === 'credit'}
                  onChange={() => setLine(index, { side: 'credit' })}
                  disabled={create.isPending}
                />
                {t('credit')}
              </label>
            </span>
            <input
              aria-label={t('amount')}
              inputMode="numeric"
              value={line.amount}
              onChange={(event) => setLine(index, { amount: event.target.value })}
              placeholder="0"
              disabled={create.isPending}
            />
            <input
              aria-label={t('lineMemo')}
              value={line.lineMemo}
              onChange={(event) => setLine(index, { lineMemo: event.target.value })}
              maxLength={500}
              disabled={create.isPending}
            />
            <button
              type="button"
              className="quiet"
              onClick={() => removeLine(index)}
              disabled={create.isPending || lines.length <= 2}
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="quiet" onClick={addLine} disabled={create.isPending}>
          {t('addLine')}
        </button>

        <p className={balanced ? 'success' : 'hint'} role="status">
          {t('totalDebit')}: <bdi>{formatAmount(totals.debit)}</bdi> ·{' '}
          {t('totalCredit')}: <bdi>{formatAmount(totals.credit)}</bdi>{' '}
          {balanced ? `— ${t('balanced')}` : `— ${t('unbalancedBy', { difference: formatAmount(difference) })}`}
        </p>

        <button type="submit" disabled={create.isPending || !balanced}>
          {create.isPending ? t('common:actions.saving') : t('submit')}
        </button>
        {create.isError && (
          <p className="error" role="alert">
            {errorMessage(create.error)}
          </p>
        )}
        {create.isSuccess && justCreated !== null && (
          <p className="success" role="status">
            {t('feedback.drafted', { entryNo: justCreated })}
          </p>
        )}
      </form>
    </CreateSection>
  );
}

function EntryLines({ lines }) {
  const { t } = useTranslation(['accountingJournal']);
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">{t('account')}</th>
            <th scope="col" className="num">{t('debit')}</th>
            <th scope="col" className="num">{t('credit')}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.id}>
              <td>
                <code>{line.accountCode}</code> {line.accountName}
                {line.memo && <span className="hint"> — {line.memo}</span>}
              </td>
              <td className="num">
                {Number(line.debit) !== 0 && <bdi>{formatAmount(line.debit)}</bdi>}
                {Number(line.debit) === 0 && '—'}
              </td>
              <td className="num">
                {Number(line.credit) !== 0 && <bdi>{formatAmount(line.credit)}</bdi>}
                {Number(line.credit) === 0 && '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JournalList({ accounts, canPost }) {
  const { t } = useTranslation(['accountingJournal', 'common']);
  const queryClient = useQueryClient();
  const today = new Date();
  const [from, setFrom] = useState(toIsoDate(startOfJalaliMonth(today)));
  const [to, setTo] = useState(toIsoDate(today));
  const [status, setStatus] = useState('');
  const [accountId, setAccountId] = useState('');
  const [openId, setOpenId] = useState(null);

  const entriesQuery = useQuery({
    queryKey: ['accounting-journal', { from, to, status, accountId }],
    queryFn: () =>
      listJournalEntries({
        from,
        to,
        status: status || undefined,
        accountId: accountId || undefined,
      }),
  });

  const invalidate = () =>
    invalidateAccounting(queryClient);
  const post = useMutation({
    mutationFn: postEntry,
    onSuccess: invalidate,
  });
  const voidIt = useMutation({
    mutationFn: voidEntry,
    onSuccess: invalidate,
  });

  const entries = entriesQuery.data?.entries ?? [];

  return (
    <section className="section-card">
      <div className="toolbar">
        <label htmlFor="journal-from">{t('filters.from')}</label>
        <JalaliDatePicker id="journal-from" value={from} onChange={setFrom} />
        <label htmlFor="journal-to">{t('filters.to')}</label>
        <JalaliDatePicker id="journal-to" value={to} onChange={setTo} />
        <select
          aria-label={t('filters.status')}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {STATUSES.map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('filters.account')}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          <option value="">{t('filters.allAccounts')}</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.code} · {account.name}
            </option>
          ))}
        </select>
      </div>

      {entriesQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {entriesQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(entriesQuery.error)}
        </p>
      )}
      {entriesQuery.data?.truncated && (
        <p className="hint">{t('list.truncated', { count: entries.length })}</p>
      )}
      {entries.length === 0 && !entriesQuery.isPending && (
        <EmptyState title={t('list.empty')} />
      )}

      {entries.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
            <tr>
              <th scope="col">{t('list.entryNo')}</th>
              <th scope="col">{t('list.date')}</th>
              <th scope="col">{t('list.memo')}</th>
              <th scope="col">{t('list.source')}</th>
              <th scope="col" className="num">{t('list.total')}</th>
              <th scope="col">{t('list.status')}</th>
              {canPost && <th scope="col">{t('list.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => {
              const rows = [
                <tr
                  key={entry.id}
                  className={entry.status === 'voided' ? 'stale' : undefined}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="quiet"
                      onClick={() => setOpenId(openId === entry.id ? null : entry.id)}
                      aria-expanded={openId === entry.id}
                    >
                      № {entry.entryNo}
                    </button>
                  </th>
                  <td>{formatIsoDate(entry.entryDate)}</td>
                  <td>{entry.memo ?? '—'}</td>
                  <td>
                    <span className="badge">
                      {entry.sourceType ? t(`source.${entry.sourceType}`) : t('source.manual')}
                    </span>
                  </td>
                  <td className="num"><bdi>{formatAmount(entry.total)}</bdi></td>
                  <td>
                    <span className={`badge ${entry.status === 'posted' ? 'ok' : entry.status === 'draft' ? 'warn' : ''}`}>
                      {t(`status.${entry.status}`)}
                    </span>
                  </td>
                  {canPost && (
                    <td className="actions">
                      {entry.status === 'draft' && (
                        <button
                          type="button"
                          className="quiet"
                          onClick={() => {
                            if (window.confirm(t('actions.postConfirm'))) {
                              post.mutate(entry.id);
                            }
                          }}
                          disabled={post.isPending || voidIt.isPending}
                        >
                          {t('actions.post')}
                        </button>
                      )}
                      {entry.status === 'posted' &&
                        !['opening', 'closing'].includes(entry.sourceType) && (
                        <button
                          type="button"
                          className="danger"
                          onClick={() => {
                            if (window.confirm(t('actions.voidConfirm'))) {
                              voidIt.mutate(entry.id);
                            }
                          }}
                          disabled={post.isPending || voidIt.isPending}
                        >
                          {t('actions.void')}
                        </button>
                      )}
                    </td>
                  )}
                </tr>,
              ];
              if (openId === entry.id) {
                rows.push(
                  <tr key={`${entry.id}-lines`}>
                    <td colSpan={canPost ? 7 : 6}>
                      <EntryLines lines={entry.lines} />
                    </td>
                  </tr>
                );
              }
              return rows;
            })}
          </tbody>
        </table>
      </div>
      )}
      {(post.isError || voidIt.isError) && (
        <p className="error" role="alert">
          {errorMessage(post.error ?? voidIt.error)}
        </p>
      )}
      {post.isSuccess && post.data?.entry && (
        <p className="success" role="status">
          {t('feedback.posted', { entryNo: post.data.entry.entryNo })}
        </p>
      )}
      {voidIt.isSuccess && (
        <p className="success" role="status">{t('feedback.voided')}</p>
      )}
    </section>
  );
}

function AccountingJournalPage() {
  const { can } = useAuth();
  const { t } = useTranslation(['accountingJournal', 'common']);
  const accountsQuery = useQuery({
    queryKey: ['accounting-accounts', { includeInactive: false }],
    queryFn: () => listAccounts(),
  });
  const accounts = accountsQuery.data ?? [];
  const canEnter = can('accounting.enter');
  const canPost = can('accounting.post');

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('title')}</h1>
          <p className="hint">{t('hint')}</p>
        </div>
      </div>

      {canEnter && <NewEntryForm accounts={accounts} />}
      <JournalList accounts={accounts} canPost={canPost} />
    </main>
  );
}

export default AccountingJournalPage;
