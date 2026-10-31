import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import { getCafeReport } from '../api/cafeReports.js';
import { getIncomeStatement } from '../api/accountingReports.js';
import { listPeriods } from '../api/accountingAdmin.js';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate } from '../lib/format.js';

function QueryState({ query }) {
  const { t } = useTranslation('recovery');
  if (query.isError) return <p className="error" role="alert">{errorMessage(query.error)} <button type="button" onClick={() => query.refetch()}>{t('retry')}</button></p>;
  if (query.isPending) return <p className="hint" role="status">{t('loading')}</p>;
  return null;
}

function Metric({ label, value, detail, href, mark }) {
  return <article className="section-card home-metric">
    <div className="home-metric-label"><span>{label}</span><span aria-hidden="true" className="home-mark">{mark}</span></div>
    <strong className="home-metric-value">{value}</strong>
    <span className="hint">{detail}</span>
    {href && <Link className="home-metric-link" to={href} aria-label={label}><span aria-hidden="true">↗</span></Link>}
  </article>;
}

function SessionList({ rows, total, title, hint }) {
  const { t } = useTranslation('recovery');
  const { can } = useAuth();
  return <section className="section-card home-list">
    <div className="home-section-head"><h2>{title}</h2><span className="home-count">{total}</span></div>
    <p className="hint">{hint}</p>
    {rows.length === 0 ? <p className="home-empty">{t('home.empty')}</p> : <ul className="plain-list">
      {rows.map(row => <li key={row.id} className="home-session">
        <span className={`home-status-dot ${row.status}`} aria-hidden="true" />
        <div className="home-session-copy"><strong>{row.assignmentName || row.code}</strong><span>{row.teacherName} · {row.targetName}</span><small>{formatIsoDate(row.sessionDate)} · {t(`home.${row.status}`)}</small></div>
        {can('scores.enter') && <Link className="btn quiet" to={`/evaluate?assignmentId=${row.assignmentId}&sessionId=${row.id}`}>{t(row.status === 'notStarted' ? 'home.start' : 'home.continue')}</Link>}
      </li>)}
    </ul>}
    {total > rows.length && <p className="hint">{t('home.showing', { shown: rows.length, total })}</p>}
    {can('schedule.view') && <Link to="/sessions">{t('home.sessionsLink')} →</Link>}
  </section>;
}

function AccountingSnapshot({ today, money }) {
  const { t } = useTranslation('recovery');
  const periods = useQuery({ queryKey: ['accounting-periods'], queryFn: listPeriods });
  const period = periods.data?.find(item => item.startDate <= today && item.endDate >= today);
  const report = useQuery({ queryKey: ['accounting-income', { from: period?.startDate, to: today }], queryFn: () => getIncomeStatement({ from: period.startDate, to: today }), enabled: Boolean(period) });
  return <section className="section-card home-finance">
    <div className="home-section-head"><h2>{t('home.accounting')}</h2><Link to="/accounting/reports">{t('home.report')} ↗</Link></div>
    <QueryState query={periods} />
    {period && <><p className="hint">{period.name} · {formatIsoDate(period.startDate)} — {formatIsoDate(today)} · {t('home.postedOnly')}</p><QueryState query={report} />
      {report.data && !report.isError && <dl className="home-finance-values">
        <div><dt>{t('home.income')}</dt><dd>{money(report.data.totalIncome)}</dd></div>
        <div><dt>{t('home.expenses')}</dt><dd>{money(report.data.totalExpense)}</dd></div>
        <div><dt>{t('home.net')}</dt><dd>{money(report.data.netProfit)}</dd></div>
      </dl>}
    </>}
    {periods.isSuccess && !period && <p className="hint">{t('home.noFiscalPeriod')}</p>}
  </section>;
}

export default function HomeOverview({ query }) {
  const { t, i18n } = useTranslation('recovery');
  const { can } = useAuth();
  const today = query.data?.today;
  const cafe = useQuery({ queryKey: ['cafe-report', { from: today, to: today }], queryFn: () => getCafeReport({ from: today, to: today }), enabled: can('cafe.view') && Boolean(today), refetchInterval: 60_000 });
  const count = value => new Intl.NumberFormat(i18n.language).format(value);
  const money = value => `${count(value)} ${t('home.toman')}`;
  const data = query.data;
  return <section className="home-overview" aria-label={t('home.overview')}>
    <div className="home-section-head"><div><p className="eyebrow">{t('home.overview')}</p><h2>{t('home.todayAtAGlance')}</h2></div>{today && <span className="hint">{formatIsoDate(today)} · {data.timeZone}</span>}</div>
    <QueryState query={query} />
    {data && !query.isError && <>
      <div className="home-metrics">
        <Metric label={t('home.students')} value={count(data.studentCount)} detail={t('home.activeStudents')} href="/students" mark="◉" />
        <Metric label={t('home.classes')} value={count(data.classCount)} detail={t('home.scheduledToday')} href={can('schedule.view') ? '/sessions' : null} mark="▦" />
        <Metric label={t('home.grading')} value={count(data.gradingCount)} detail={t('home.gradingDetail', { notStarted: count(data.notStartedCount), partial: count(data.partialCount) })} mark="◷" />
        {can('cafe.view') && <Metric label={t('home.cafeToday')} value={cafe.isError ? '—' : cafe.data ? money(cafe.data.totals.revenue) : '…'} detail={cafe.isError ? t('home.unavailable') : cafe.data ? t('home.salesCount', { count: cafe.data.totals.saleCount }) : t('loading')} href="/cafe/reports" mark="☕" />}
      </div>
      <div className="home-columns">
        <SessionList rows={data.classes} total={data.classCount} title={t('home.classes')} hint={t('home.classesHint')} />
        <SessionList rows={data.grading} total={data.gradingCount} title={t('home.grading')} hint={t('home.gradingHint')} />
      </div>
      <nav className="home-quick-actions section-card" aria-label={t('home.quickActions')}>
        <strong>{t('home.quickActions')}</strong>
        {can('students.create') && <Link className="btn" to="/students">＋ {t('home.addStudent')}</Link>}
        {can('schedule.manage') && <Link className="btn" to="/schedule">{t('home.manageSchedule')}</Link>}
        {can('cafe.sell') && <Link className="btn" to="/cafe">{t('home.newSale')}</Link>}
        {can('accounting.enter') && <Link className="btn" to="/accounting/journal">{t('home.newEntry')}</Link>}
      </nav>
      <div className="home-columns">
        {can('cafe.view') && <section className="section-card home-finance">
          <div className="home-section-head"><h2>{t('home.cafeSnapshot')}</h2><Link to="/cafe/reports">{t('home.report')} ↗</Link></div>
          <QueryState query={cafe} />
          {cafe.data && !cafe.isError && <><p className="hint">{t('home.cafeHint')}</p><dl className="home-finance-values"><div><dt>{t('home.sales')}</dt><dd>{money(cafe.data.totals.revenue)}</dd></div><div><dt>{t('home.grossProfit')}</dt><dd>{money(cafe.data.totals.profit)}</dd></div><div><dt>{t('home.debt')}</dt><dd>{money(cafe.data.outstandingDebt)}</dd></div></dl></>}
        </section>}
        {can('accounting.view') && <AccountingSnapshot today={today} money={money} />}
      </div>
    </>}
  </section>;
}
