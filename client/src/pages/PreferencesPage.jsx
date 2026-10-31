import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listParameters } from '../api/parameters.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { LANGUAGES } from '../i18n/index.js';
import { errorMessage } from '../i18n/errors.js';
import { toggleHidden } from '../lib/prefs.js';
import { usePreferences } from '../preferences/PreferencesContext.jsx';
import { PERSIAN_FONTS } from '../lib/fonts.js';

const THEMES = ['system', 'light', 'dark'];
const PALETTES = [
  {
    value: 'aurum-glass',
    preview: { paper: '#2b2d30', surface: '#46474999', line: '#ffffff24', spine: '#202224', brand: '#e7c567' },
  },
  {
    value: 'aurum',
    preview: { paper: '#282a2e', surface: '#36383c', line: '#45474b', spine: '#202124', brand: '#e7c567' },
  },
  {
    value: 'aurora',
    preview: {
      paper: '#f4f5f7',
      surface: '#ffffff',
      line: '#e6e8ec',
      spine: '#16181d',
      brand: '#cf4c0d',
    },
  },
  {
    value: 'gradebook',
    preview: {
      paper: '#f4f5fb',
      surface: '#ffffff',
      line: '#e2e5f0',
      spine: '#141b2e',
      brand: '#4f46e5',
    },
  },
  {
    value: 'midnight',
    preview: {
      paper: '#eef2fb',
      surface: '#ffffff',
      line: '#dae2f2',
      spine: '#0e1730',
      brand: '#2563eb',
    },
  },
  {
    value: 'ember',
    preview: {
      paper: '#faf6f1',
      surface: '#fffdfb',
      line: '#ece1d4',
      spine: '#1f1a15',
      brand: '#c2410c',
    },
  },
  {
    value: 'meadow',
    preview: {
      paper: '#f2f8f4',
      surface: '#ffffff',
      line: '#dbeae1',
      spine: '#0e241b',
      brand: '#047857',
    },
  },
  {
    value: 'cobalt',
    preview: {
      paper: '#f4f5f7',
      surface: '#ffffff',
      line: '#e6e8ec',
      spine: '#16181d',
      brand: '#1d6fe0',
    },
  },
  {
    value: 'crimson',
    preview: {
      paper: '#f4f5f7',
      surface: '#ffffff',
      line: '#e6e8ec',
      spine: '#0b0b0d',
      brand: '#d21f3c',
    },
  },
];
const PAGE_SIZES = [10, 25, 50, 100];
const SORTS = ['newest', 'oldest', 'name', 'code'];
const TABS = ['overview', 'period', 'parameter'];

function PreferencesPage() {
  const { t } = useTranslation(['admin', 'common', 'recovery']);
  const { preferences, update, reset } = usePreferences();
  const { can } = useAuth();
  // The "hide parameters from the overview" control only makes sense for a role
  // that can actually see parameters; without parameters.view the query would
  // 403. Gate both the fetch and the section on the permission.
  const canViewParameters = can('parameters.view');
  const canEnterScores = can('scores.enter');
  const canExport = can('data.export');
  const parametersQuery = useQuery({
    queryKey: ['parameters'],
    queryFn: listParameters,
    enabled: canViewParameters,
  });

  function change(changes) {
    update.mutate(changes);
  }

  function handleReset() {
    if (window.confirm(t('preferences.resetConfirm'))) {
      reset.mutate();
    }
  }

  let status = null;
  if (update.isPending || reset.isPending) {
    status = <span>{t('preferences.statusSaving')}</span>;
  } else if (update.isError) {
    status = (
      <span className="error" role="alert">
        {t('preferences.statusSaveError', {
          message: errorMessage(update.error),
        })}
      </span>
    );
  } else if (reset.isError) {
    status = (
      <span className="error" role="alert">
        {t('preferences.statusResetError', {
          message: errorMessage(reset.error),
        })}
      </span>
    );
  } else if (update.isSuccess || reset.isSuccess) {
    status = (
      <span className="success" role="status">
        {t('preferences.statusSaved')}
      </span>
    );
  }

  return (
    <main className="preferences-page">
      <h1>{t('preferences.title')}</h1>
      <p className="hint">{t('preferences.hint')}</p>
      <p role="status" className="status-line">
        {status}
      </p>

      <section className="section-card">
        <h2>{t('preferences.appearance')}</h2>
        <p className="hint">{t('preferences.appearanceHint')}</p>
        <fieldset className="pref-group">
          <legend>{t('preferences.theme')}</legend>
          <div
            className="segmented"
            role="radiogroup"
            aria-label={t('preferences.theme')}
          >
            {THEMES.map((value) => (
              <label key={value}>
                <input
                  type="radio"
                  name="theme"
                  checked={preferences.theme === value}
                  onChange={() => change({ theme: value })}
                />
                {t(`preferences.themes.${value}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="pref-group">
          <legend>{t('preferences.palette')}</legend>
          <div className="palette-swatches">
            {PALETTES.map((option) => (
              <label key={option.value} className="palette-option">
                <input
                  type="radio"
                  name="palette"
                  checked={(preferences.palette ?? 'aurora') === option.value}
                  onChange={() => change({ palette: option.value })}
                />
                <span
                  className="palette-preview"
                  style={{
                    '--pv-paper': option.preview.paper,
                    '--pv-surface': option.preview.surface,
                    '--pv-line': option.preview.line,
                    '--pv-spine': option.preview.spine,
                    '--pv-brand': option.preview.brand,
                  }}
                  aria-hidden="true"
                >
                  <span className="palette-preview-spine" />
                  <span className="palette-preview-body">
                    <span className="palette-preview-bar" />
                    <span className="palette-preview-bar short" />
                    <span className="palette-preview-dot" />
                  </span>
                </span>
                <span className="palette-name">
                  {['aurum', 'aurum-glass'].includes(option.value) ? t(`recovery:${option.value}`) : t(`preferences.palettes.${option.value}`)}
                </span>
              </label>
            ))}
          </div>
          <p className="hint">{t('preferences.paletteHint')}</p>
        </fieldset>
      </section>

      <section className="section-card">
        <h2>{t('common:preferences.languageTitle')}</h2>
        <p className="hint">{t('common:preferences.languageHint')}</p>
        <fieldset className="pref-group">
          <legend aria-hidden="true">
            {t('common:preferences.languageTitle')}
          </legend>
          <div
            className="segmented"
            role="radiogroup"
            aria-label={t('common:preferences.languageTitle')}
          >
            {LANGUAGES.map((code) => (
              <label key={code}>
                <input
                  type="radio"
                  name="language"
                  checked={(preferences.language ?? 'fa') === code}
                  onChange={() => change({ language: code })}
                />
                {t(`common:language.${code}`)}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="pref-group">
          <legend>{t('recovery:font.title')}</legend>
          <p className="hint">{t('recovery:font.hint')}</p>
          <div className="font-choices">
            {PERSIAN_FONTS.map(font => <label className="font-option" key={font.id} style={{ fontFamily: font.family }}>
              <span className="tw:flex tw:items-center tw:gap-2">
                <input type="radio" name="persianFont" value={font.id} checked={(preferences.persianFont ?? 'vazirmatn') === font.id} onChange={() => change({ persianFont: font.id })} />
                <strong lang="fa">{font.name}</strong>
                {font.id === 'vazirmatn' && <small>{t('recovery:font.recommended')}</small>}
              </span>
              <span className="font-sample" lang="fa" dir="rtl">هر روز، فرصتی برای یادگیری</span>
              <span className="hint" lang="fa" dir="rtl">دانش‌آموزان · پیشرفت · ۱۲۳۴۵۶۷۸۹۰</span>
            </label>)}
          </div>
        </fieldset>
        <fieldset className="pref-group">
          <legend>{t('recovery:cursor.title')}</legend>
          <div className="segmented">
            {[false, true].map(value => <label key={String(value)}><input type="radio" name="cursor" checked={(preferences.customCursor !== false) === value} onChange={() => change({ customCursor: value })} />{t(value ? 'recovery:cursor.wave' : 'recovery:cursor.native')}</label>)}
          </div>
        </fieldset>
      </section>

      <section className="section-card">
        <h2>{t('preferences.studentsList')}</h2>
        <div className="pref-group">
          <label className="inline">
            {t('preferences.rowsPerPage')}
            <select
              value={preferences.studentsPageSize}
              onChange={(event) =>
                change({ studentsPageSize: Number(event.target.value) })
              }
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            {t('preferences.sortBy')}
            <select
              value={preferences.studentsSort}
              onChange={(event) => change({ studentsSort: event.target.value })}
            >
              {SORTS.map((value) => (
                <option key={value} value={value}>
                  {t(`preferences.sorts.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={preferences.studentsShowCode}
              onChange={(event) =>
                change({ studentsShowCode: event.target.checked })
              }
            />
            {t('preferences.showCode')}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={preferences.studentsShowAdded}
              onChange={(event) =>
                change({ studentsShowAdded: event.target.checked })
              }
            />
            {t('preferences.showAdded')}
          </label>
        </div>
        {canEnterScores && (
          <p className="hint">{t('preferences.sortHint')}</p>
        )}
      </section>

      <section className="section-card">
        <h2>{t('preferences.studentPage')}</h2>
        <div className="pref-group">
          <label className="inline">
            {t('preferences.openOn')}
            <select
              value={preferences.studentDefaultTab}
              onChange={(event) =>
                change({ studentDefaultTab: event.target.value })
              }
            >
              {TABS.map((value) => (
                <option key={value} value={value}>
                  {t(`preferences.tabs.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={preferences.studentShowAllPeriods}
              onChange={(event) =>
                change({ studentShowAllPeriods: event.target.checked })
              }
            />
            {t('preferences.showAllPeriods')}
          </label>
        </div>

        {canViewParameters && (
          <>
            <h3>{t('preferences.parametersShown')}</h3>
            {parametersQuery.isPending && (
              <p className="hint">{t('common:status.loading')}</p>
            )}
            {parametersQuery.isError && (
              <p className="error">{errorMessage(parametersQuery.error)}</p>
            )}
            {parametersQuery.data && parametersQuery.data.length === 0 && (
              <p className="hint">{t('preferences.noParameters')}</p>
            )}
            <div className="pref-group">
              {parametersQuery.data?.map((parameter) => (
                <label key={parameter.id} className="inline">
                  <input
                    type="checkbox"
                    checked={!preferences.hiddenParameterIds.includes(parameter.id)}
                    onChange={(event) =>
                      change({
                        hiddenParameterIds: toggleHidden(
                          preferences.hiddenParameterIds,
                          parameter.id,
                          event.target.checked
                        ),
                      })
                    }
                  />
                  {parameter.path || parameter.name}
                </label>
              ))}
            </div>
            <p className="hint">{t('preferences.hiddenStillShown')}</p>
          </>
        )}
      </section>

      {canExport && (
        <section className="section-card">
          <h2>{t('preferences.export')}</h2>
          <div className="pref-group">
            <label className="inline">
              {t('preferences.separator')}
              <select
                value={preferences.csvDelimiter}
                onChange={(event) => change({ csvDelimiter: event.target.value })}
              >
                <option value=",">{t('preferences.sepComma')}</option>
                <option value=";">{t('preferences.sepSemicolon')}</option>
              </select>
            </label>
          </div>
          <p className="hint">{t('preferences.exportHint')}</p>
        </section>
      )}

      <section className="section-card">
        <h2>{t('preferences.resetTitle')}</h2>
        <p className="hint">{t('preferences.resetHint')}</p>
        <button type="button" onClick={handleReset} disabled={reset.isPending}>
          {t('preferences.resetBtn')}
        </button>
      </section>
    </main>
  );
}

export default PreferencesPage;
