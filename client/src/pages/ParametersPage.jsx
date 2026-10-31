import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import ParameterForm from '../components/ParameterForm.jsx';
import CreateSection from '../components/CreateSection.jsx';
import ParametersTable from '../components/ParametersTable.jsx';

// The parameter catalogue: code, name, and the shared integer range. There is
// no change history anymore — applicability is the evaluator's cell selection,
// so a parameter is simply live for any session's grid.
function ParametersPage() {
  const { t } = useTranslation(['students', 'common']);
  const { can } = useAuth();

  // The Parameters screen is a management surface. Reading parameter *values*
  // elsewhere only needs parameters.view, but this page is gated on
  // parameters.manage so roles that can merely see scores (Viewer, Staff)
  // don't get a settings-like panel.
  if (!can('parameters.manage')) {
    return (
      <main>
        <h1>{t('parameters.title')}</h1>
        <EmptyState
          title={t('shared.readOnlyTitle')}
          description={t('parameters.readOnlyDescription')}
        />
      </main>
    );
  }

  return (
    <main className="wide">
      <h1>{t('parameters.title')}</h1>
      <p className="hint">{t('parameters.hint')}</p>

      <CreateSection title={t('parameters.addTitle')}>
        <ParameterForm />
      </CreateSection>

      <section className="section-card">
        <h2>{t('parameters.allTitle')}</h2>
        <ParametersTable />
      </section>
    </main>
  );
}

export default ParametersPage;
