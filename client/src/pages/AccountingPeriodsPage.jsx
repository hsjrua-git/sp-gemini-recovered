import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  closePeriod,
  createOpening,
  createPeriod,
  getOpening,
  listPeriods,
  reopenPeriod,
  updatePeriod,
} from '../api/accountingAdmin.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JalaliDatePicker from '../components/JalaliDatePicker.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate, toIsoDate } from '../lib/format.js';
import { formatWhole } from '../lib/money.js';
import { invalidateAccounting } from '../lib/accountingCache.js';

// Fiscal periods: the close books an automatic closing entry (income and
// expenses zeroed into retained earnings) and locks the range; reopening is
// possible and the closing entry stays. The opening entry — the adopt-
// accounting snapshot of cafe stock and student balances — lives here too.

function OpeningCard({ canCreate }) {
  const { t } = useTranslation(['accountingAdmin', 'accountingReports', 'common']);
  const queryClient = useQueryClient();
  const [date, setDate] = useState(toIsoDate(new Date()));

  const openingQuery = useQuery({
    queryKey: ['accounting-opening'],
    queryFn: getOpening,
  });
  const opening = openingQuery.data ?? null;

  const create = useMutation({
    mutationFn: () => createOpening({ date }),
    onSuccess: () => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['accounting-opening'] }),
      invalidateAccounting(queryClient),
    ]),
  });

  return (
    <section className="section-card">
      <h2>{t('opening.title')}</h2>
      {openingQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
      {openingQuery.isError && (
        <p className="error" role="alert">
          {errorMessage(openingQuery.error)}
        </p>
      )}
      {opening ? (
        <p className="success" role="status">
          {t('opening.exists', {
            entryNo: opening.entryNo,
            entryDate: formatIsoDate(opening.entryDate),
            total: `${formatWhole(Number(opening.total))} ${t('moneyUnit', { ns: 'accountingReports' })}`,
          })}
        </p>
      ) : (
        <p className="hint">{t('opening.missing')}</p>
      )}
      {canCreate && !opening && (
        <div className="row">
          <label htmlFor="opening-date">{t('opening.date')}</label>
          <JalaliDatePicker
            id="opening-date"
            value={date}
            onChange={setDate}
            disabled={create.isPending}
          />
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
          >
            {create.isPending
              ? t('common:actions.saving')
              : t('opening.create')}
          </button>
        </div>
      )}
      {create.isError && (
        <p className="error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
      {create.isSuccess && (
        <p className="success" role="status">
          {t('opening.created', { entryNo: create.data.entryNo })}
        </p>
      )}
    </section>
  );
}

function PeriodForm({ initial, onDone }) {
  const { t } = useTranslation(['accountingAdmin', 'common']);
  const queryClient = useQueryClient();
  const [name, setName] = useState(initial?.name ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');

  const save = useMutation({
    mutationFn: () =>
      initial
        ? updatePeriod(initial.id, { name, startDate, endDate })
        : createPeriod({ name, startDate, endDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['accounting-periods'] });
      onDone();
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    save.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="edit-form">
      <label htmlFor={`period-name-${initial ? initial.id : 'new'}`}>
        {t('periods.name')}
      </label>
      <input
        id={`period-name-${initial ? initial.id : 'new'}`}
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={80}
        disabled={save.isPending}
      />
      <div className="row">
        <label htmlFor={`period-start-${initial ? initial.id : 'new'}`}>
          {t('periods.startDate')}
        </label>
        <JalaliDatePicker
          id={`period-start-${initial ? initial.id : 'new'}`}
          value={startDate}
          onChange={setStartDate}
          disabled={save.isPending}
        />
        <label htmlFor={`period-end-${initial ? initial.id : 'new'}`}>
          {t('periods.endDate')}
        </label>
        <JalaliDatePicker
          id={`period-end-${initial ? initial.id : 'new'}`}
          value={endDate}
          onChange={setEndDate}
          disabled={save.isPending}
        />
      </div>
      <div className="row">
        <button
          type="submit"
          disabled={save.isPending || name.trim() === '' || !startDate || !endDate}
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

function AccountingPeriodsPage() {
  const { can } = useAuth();
  const { t } = useTranslation(['accountingAdmin', 'common']);
  const queryClient = useQueryClient();
  const canManage = can('accounting.manage');
  const canClose = can('accounting.close');
  const canPost = can('accounting.post');
  const canAct = canManage || canClose;
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const periodsQuery = useQuery({
    queryKey: ['accounting-periods'],
    queryFn: listPeriods,
  });
  const periods = periodsQuery.data ?? [];

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['accounting-periods'] }),
    invalidateAccounting(queryClient),
  ]);
  const close = useMutation({
    mutationFn: closePeriod,
    onSuccess: invalidate,
  });
  const reopen = useMutation({
    mutationFn: reopenPeriod,
    onSuccess: invalidate,
  });

  return (
    <main className="wide">
      <div className="page-head">
        <div>
          <h1>{t('periods.title')}</h1>
        </div>
      </div>

      <OpeningCard canCreate={canManage && canPost} />

      <section className="section-card">
        <h2>{t('periods.title')}</h2>
        {periodsQuery.isPending && <p className="hint">{t('common:status.loading')}</p>}
        {periodsQuery.isError && (
          <p className="error" role="alert">
            {errorMessage(periodsQuery.error)}
          </p>
        )}
        {periods.length === 0 && !periodsQuery.isPending && (
          <EmptyState title={t('periods.empty')} />
        )}
        {periods.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
              <tr>
                <th scope="col">{t('periods.name')}</th>
                <th scope="col">{t('periods.range')}</th>
                <th scope="col">{t('periods.status')}</th>
                <th scope="col" className="num">{t('periods.postedCount')}</th>
                {canAct && <th scope="col">{t('periods.actions')}</th>}
              </tr>
            </thead>
            <tbody>
              {periods.map((period) =>
                editingId === period.id ? (
                  <tr key={period.id}>
                    <td colSpan={canAct ? 5 : 4}>
                      <PeriodForm
                        initial={period}
                        onDone={() => setEditingId(null)}
                      />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={period.id}
                    className={period.status === 'closed' ? 'stale' : undefined}
                  >
                    <th scope="row">{period.name}</th>
                    <td>
                      {formatIsoDate(period.startDate)} — {formatIsoDate(period.endDate)}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          period.status === 'open' ? 'ok' : ''
                        }`}
                      >
                        {t(`periods.${period.status}`)}
                      </span>
                    </td>
                    <td className="num">{period.postedEntryCount}</td>
                    {canAct && (
                      <td className="actions">
                        {period.status === 'open' ? (
                          <>
                            {canManage && (
                              <>
                                <button
                                  type="button"
                                  className="quiet"
                                  onClick={() => setEditingId(period.id)}
                                  disabled={close.isPending || reopen.isPending}
                                >
                                  {t('accounts.edit')}
                                </button>{' '}
                              </>
                            )}
                            {canClose && (
                              <button
                                type="button"
                                className="danger"
                                onClick={() => {
                                  if (window.confirm(t('periods.closeConfirm'))) {
                                    close.mutate(period.id);
                                  }
                                }}
                                disabled={close.isPending || reopen.isPending}
                              >
                                {t('periods.close')}
                              </button>
                            )}
                          </>
                        ) : (
                          canClose && (
                            <button
                              type="button"
                              className="quiet"
                              onClick={() => {
                                if (window.confirm(t('periods.reopenConfirm'))) {
                                  reopen.mutate(period.id);
                                }
                              }}
                              disabled={close.isPending || reopen.isPending}
                            >
                              {t('periods.reopen')}
                            </button>
                          )
                        )}
                        {close.isError && close.variables === period.id && (
                          <p className="error" role="alert">
                            {errorMessage(close.error)}
                          </p>
                        )}
                        {reopen.isError && reopen.variables === period.id && (
                          <p className="error" role="alert">
                            {errorMessage(reopen.error)}
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
            <PeriodForm onDone={() => setCreating(false)} />
          ) : (
            <button type="button" onClick={() => setCreating(true)}>
              {t('periods.newPeriod')}
            </button>
          ))}
        {periods.some((period) => period.status === 'closed') && (
          <p className="hint">{t('periods.closedHint')}</p>
        )}
      </section>
    </main>
  );
}

export default AccountingPeriodsPage;
