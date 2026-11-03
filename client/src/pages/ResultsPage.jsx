import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { createSavedView, deleteSavedView, listSavedViews, updateSavedView } from '../api/savedViews.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import FilterEditor from '../components/FilterEditor.jsx';
import ResultsTable from '../components/ResultsTable.jsx';
import SavedViewsBar from '../components/SavedViewsBar.jsx';
import ReportScopePicker from '../components/ReportScopePicker.jsx';
import AcademicRecovery from '../components/AcademicRecovery.jsx';
import TreePicker from '../components/TreePicker.jsx';
import ExportButton from '../components/ExportButton.jsx';
import { formatIsoDate } from '../lib/format.js';
import { applyView, defaultConfig, normalizeConfig, sameConfig, toggleSort, withFilterKeys } from '../lib/resultsView.js';
import { useReportScope, useReportResults } from '../lib/useReportScope.js';
import { savedReportScope } from '../lib/reportPrefill.js';

export default function ResultsPage() {
  const { t } = useTranslation(['reports', 'common', 'workflows']);
  const { can } = useAuth();
  const client = useQueryClient();
  const report = useReportScope();
  const query = useReportResults(report);
  const [config, setConfig] = useState(() => withFilterKeys(defaultConfig()));
  const [activeView, setActiveView] = useState(null);
  const [viewEditor, setViewEditor] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const patch = changes => setConfig(current => ({ ...current, ...changes }));
  const savedConfig = { ...config, reportScope: report.scope };
  const views = useQuery({ queryKey: ['saved-views'], queryFn: listSavedViews });
  const refresh = view => { setActiveView(view); setViewEditor(null); client.invalidateQueries({ queryKey: ['saved-views'] }); };
  const create = useMutation({ mutationFn: createSavedView, onSuccess: refresh });
  const update = useMutation({ mutationFn: ({ id, fields }) => updateSavedView(id, fields), onSuccess: refresh });
  const remove = useMutation({ mutationFn: deleteSavedView, onSuccess: () => refresh(null) });
  const parameters = query.data?.parameters ?? [];
  const columns = parameters.filter(p => !config.parameterIds.length || config.parameterIds.includes(p.id));
  const grids = (query.data?.grids ?? []).flatMap(grid => report.scope.dimensions.map(dimension => ({
    ...grid, dimension, view: applyView({ rows: grid.rows, parameters, config: { ...config, dimension } }),
  })));
  function saveAs() {
    setViewEditor({ mode: 'create', name: '' });
  }
  function load(id) {
    const view = views.data?.find(item => item.id === id);
    setLoadError(null);
    if (!view) { setActiveView(null); return; }
    const scope = savedReportScope(view.config, report.periods);
    if (!scope) { setLoadError(t('workflows:scopeUnavailable')); return; }
    setActiveView(view);
    setConfig(withFilterKeys(normalizeConfig(view.config)));
    report.change(scope);
  }
  function csvRows() {
    const header = ['Assignment', 'Period', 'Dimension', 'Student code', 'Full name',
      ...columns.flatMap(p => [p.path || p.name, ...(config.showChange ? [`${p.path || p.name} (change)`] : [])])];
    return [header, ...grids.flatMap(grid => grid.view.rows.map(row => [grid.assignment.name || grid.assignment.code,
      grid.period.seq, grid.dimension === 'quality' ? 'Quality (%)' : 'Quantity', row.studentCode, row.fullName,
      ...columns.flatMap(p => { const value = row.cells[p.id]?.[grid.dimension] ?? null;
        const previous = row.previous[p.id]?.[grid.dimension];
        return [value, ...(config.showChange ? [value != null && previous != null ? value - previous : null] : [])]; }),
    ]))];
  }
  return <main className="wide results">
    <h1>{t('results.title')}</h1>
    <ReportScopePicker report={report} />
    {can('scores.override') && <AcademicRecovery kind="periods" />}
    <SavedViewsBar views={views.data ?? []} activeId={activeView?.id ?? null}
      dirty={Boolean(activeView && !sameConfig(savedConfig, activeView.config))}
      busy={report.isPending || create.isPending || update.isPending || remove.isPending}
      error={errorMessage(create.error || update.error || remove.error || views.error)} onLoad={load} onSaveAs={saveAs}
      onUpdate={() => update.mutate({ id: activeView.id, fields: { config: normalizeConfig(savedConfig) } })}
      onRename={() => setViewEditor({ mode: 'rename', name: activeView.name })}
      onDelete={() => { if (window.confirm(t('results.confirmDelete', { name: activeView.name }))) remove.mutate(activeView.id); }}
      onReset={() => { setConfig(withFilterKeys(defaultConfig())); setActiveView(null); }} />
    {loadError && <p className="error" role="alert">{loadError}</p>}
    {viewEditor && <form className="toolbar" onSubmit={event => {
      event.preventDefault();
      const name = viewEditor.name.trim();
      if (!name) return;
      if (viewEditor.mode === 'create') create.mutate({ name, config: normalizeConfig(savedConfig) });
      else update.mutate({ id: activeView.id, fields: { name } });
    }}>
      <label>{t('results.promptName')}<input required maxLength={60} value={viewEditor.name} onChange={event => setViewEditor({ ...viewEditor, name: event.target.value })} /></label>
      <button type="submit" disabled={create.isPending || update.isPending}>{t('common:actions.save')}</button>
      <button type="button" onClick={() => setViewEditor(null)}>{t('common:actions.cancel')}</button>
    </form>}
    <div className="toolbar">
      <input type="search" value={config.search} aria-label={t('results.searchLabel')} placeholder={t('results.searchPlaceholder')} onChange={event => patch({ search: event.target.value })} />
      <label className="inline"><input type="checkbox" checked={config.showChange} onChange={event => patch({ showChange: event.target.checked })} />{t('results.showChange')}</label>
      {can('data.export') && <><ExportButton label={t('results.exportCsv')} filename="results-selection.csv" disabled={!grids.length} buildRows={csvRows} />
        <Link className="btn" to="/export" state={{ export: { search: config.search, filters: config.filters, parameters: { mode: config.parameterIds.length ? 'selection' : 'all', ids: config.parameterIds } } }}>{t('workflows:scope.export')}</Link></>}
    </div>
    <details className="panel"><summary>{t('results.columnsSummary', { chosen: columns.length, total: parameters.length })}</summary>
      <TreePicker label={t('shared.parameter')} items={parameters} value={config.parameterIds} onChange={parameterIds => patch({ parameterIds })} includeBranch />
    </details>
    <section className="section-card"><h2>{t('filter.title')}</h2>
      <FilterEditor filters={config.filters} parameters={parameters} onChange={filters => patch({ filters })} />
    </section>
    {query.isPending && <p role="status">{t('common:status.loading')}</p>}
    {(report.error || query.error) && <p role="alert" className="error">{errorMessage(report.error || query.error)}</p>}
    {query.tooMany && <p className="error">{t('workflows:scope.limit')}</p>}
    {!query.isPending && !grids.length && <p>{t('workflows:scope.empty')}</p>}
    {grids.map(grid => <section className="section-card" key={`${grid.period.id}:${grid.dimension}`}>
      <h2>{grid.assignment.name || grid.assignment.code} · {t('workflows:scope.period', { seq: grid.period.seq })} · {t(`workflows:scope.${grid.dimension}`)}</h2>
      <p className="hint">{formatIsoDate(grid.period.startDate)} – {formatIsoDate(grid.period.endDate)}</p>
      <ResultsTable rows={grid.view.rows} columns={columns} stats={grid.view.stats} sort={config.sort} onSort={key => patch({ sort: toggleSort(config.sort, key) })}
        showChange={config.showChange} dimension={grid.dimension} hasPrevious={grid.hasPrevious} />
    </section>)}
  </main>;
}
