import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { listUsers } from '../api/users.js';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import TemporaryPasswordNotice from '../components/TemporaryPasswordNotice.jsx';
import UserForm from '../components/UserForm.jsx';
import CreateSection from '../components/CreateSection.jsx';
import UserRow from '../components/UserRow.jsx';
import { errorMessage } from '../i18n/errors.js';

function UsersPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { user: me, can } = useAuth();
  const [notice, setNotice] = useState(null);

  const query = useQuery({
    queryKey: ['users'],
    queryFn: listUsers,
    enabled: can('users.manage'),
  });

  if (!can('users.manage')) {
    return (
      <main>
        <EmptyState
          title={t('users.readOnlyTitle')}
          description={t('users.readOnlyDescription')}
        />
      </main>
    );
  }

  return (
    <main className="wide">
      <h1>{t('users.title')}</h1>
      <p className="hint">{t('users.hint')}</p>

      {notice && (
        <TemporaryPasswordNotice
          notice={notice}
          onDismiss={() => setNotice(null)}
        />
      )}

      <CreateSection title={t('users.addTitle')}>
        <UserForm onNotice={setNotice} />
      </CreateSection>

      <section className="section-card">
        <h2>{t('users.allTitle')}</h2>
        {query.isPending && <p className="hint">{t('common:status.loading')}</p>}
        {query.isError && (
          <p className="error">{errorMessage(query.error)}</p>
        )}
        {query.data && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('users.colUsername')}</th>
                  <th>{t('users.colFullName')}</th>
                  <th>{t('users.colRole')}</th>
                  <th>{t('users.colStatus')}</th>
                  <th>{t('users.colLastLogin')}</th>
                  <th>{t('common:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((user) => (
                  <UserRow
                    key={user.id}
                    user={user}
                    isSelf={user.id === me.id}
                    onNotice={setNotice}
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

export default UsersPage;
