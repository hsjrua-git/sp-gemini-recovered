import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { deleteAlert, listAlerts, resolveAlert, scanAlerts } from '../api/alerts.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { formatIsoDate } from '../lib/format.js';
import { errorMessage } from '../i18n/errors.js';

const SHOWN = 8;

// The dashboard's session-hygiene touchpoint: past sessions that have no record
// at all (not canceled, no note, no tasks) surface here as open alerts. The
// card stays completely absent while everything is fine — or while we can't
// tell — so a healthy dashboard looks exactly as it did without this feature.
function SessionAlertsCard() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const queryClient = useQueryClient();
  const canManage = can('schedule.manage');

  const alertsQuery = useQuery({
    queryKey: ['alerts', 'open'],
    queryFn: () => listAlerts({ status: 'open' }),
    enabled: can('schedule.view'),
  });

  const resolve = useMutation({
    mutationFn: (alert) => resolveAlert(alert.id, true),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });
  const scan = useMutation({
    mutationFn: scanAlerts,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  const remove = useMutation({
    mutationFn: deleteAlert,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['alerts'] }),
  });

  if (alertsQuery.isPending || alertsQuery.isError) return null;
  const { alerts, truncated } = alertsQuery.data;
  if (alerts.length === 0 && !canManage) return null;

  const shown = alerts.slice(0, SHOWN);

  return (
    <section className="section-card">
      <h2>{t('sessions.alertsCard.title')}</h2>
      <p className="hint">{t('sessions.alertsCard.hint')}</p>
      <ul className="plain-list">
        {shown.map((alert) => (
          <li key={alert.id}>
            {formatIsoDate(alert.sessionDate)} — {alert.teacherName} —{' '}
            <code>{alert.sessionCode}</code> —{' '}
            {alert.groupName
              ? t('sessions.targetGroup', { name: alert.groupName })
              : alert.studentName ?? '—'}
            {canManage && (
              <>
                {' '}
                <button
                  type="button"
                  className="quiet"
                  onClick={() => resolve.mutate(alert)}
                  disabled={resolve.isPending}
                >
                  {t('sessions.alertsCard.resolve')}
                </button>
                <button type="button" className="quiet danger" onClick={() => remove.mutate(alert.id)} disabled={remove.isPending}>{t('common:actions.delete')}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {(truncated || alerts.length > SHOWN) && (
        <p className="hint">
          {truncated &&
            t('sessions.alertsCard.showing', {
              count: alerts.length,
              shown: SHOWN,
              total: alerts.length,
            })}{' '}
          <Link to="/sessions">{t('sessions.alertsCard.sessionsLink')}</Link>
        </p>
      )}
      {canManage && (
        <div className="row">
          <button
            type="button"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            {scan.isPending
              ? t('sessions.alertsCard.scanning')
              : t('sessions.alertsCard.scanNow')}
          </button>
          {scan.isSuccess && (
            <span className="success" role="status">
              {scan.data.raised === 0 && scan.data.resolved === 0
                ? t('sessions.scan.nothing')
                : t('sessions.scan.result', {
                    count: scan.data.raised,
                    raised: scan.data.raised,
                    resolved: scan.data.resolved,
                  })}
            </span>
          )}
        </div>
      )}
      {(resolve.isError || scan.isError || remove.isError) && (
        <p className="error" role="alert">
          {errorMessage(resolve.error ?? scan.error ?? remove.error)}
        </p>
      )}
    </section>
  );
}

export default SessionAlertsCard;
