import { useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { listStudents } from '../api/students.js';
import { listFieldDefinitions } from '../api/fields.js';
import { useAuth } from '../auth/AuthContext.jsx';
import ExportButton from '../components/ExportButton.jsx';
import ExportLink from '../components/ExportLink.jsx';
import GroupFilter from '../components/GroupFilter.jsx';
import StudentForm from '../components/StudentForm.jsx';
import CreateSection from '../components/CreateSection.jsx';
import StudentsTable from '../components/StudentsTable.jsx';
import { studentsCsvRows } from '../lib/exports.js';
import { toIsoDate } from '../lib/format.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';

// Pull every student on the current filter, for CSV export.
async function fetchFilteredStudents(groupId) {
  const all = [];
  for (let page = 1; page <= 50; page++) {
    const data = await listStudents({
      page,
      pageSize: 100,
      sort: 'name',
      groupId: groupId || null,
    });
    all.push(...data.students);
    if (all.length >= data.total || data.students.length === 0) break;
  }
  return all;
}

function StudentsPage() {
  const { t } = useTranslation(['students', 'common']);
  const { can } = useAuth();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [groupId, setGroupId] = useState('');
  const search = useDebouncedValue(searchText.trim(), 300);

  function handleSearchChange(event) {
    setSearchText(event.target.value);
    setPage(1);
  }

  function handleGroupChange(value) {
    setGroupId(value);
    setPage(1);
  }

  return (
    <main className="wide">
      <div className="page-head">
        <h1>{t('list.title')}</h1>
        {can('data.import') && (
          <div className="page-head-actions">
            <Link className="btn" to="/students/import">
              {t('list.importFromCsv')}
            </Link>
          </div>
        )}
      </div>
      {can('students.create') && (
        <CreateSection title={t('list.addTitle')}>
          <StudentForm />
        </CreateSection>
      )}
      <section className="section-card">
        <h2>{t('list.allTitle')}</h2>
        <div className="toolbar">
          <input
            type="search"
            className="search"
            value={searchText}
            onChange={handleSearchChange}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchLabel')}
          />
          <GroupFilter value={groupId} onChange={handleGroupChange} />
          {can('data.export') && (
            <ExportButton
              label={t('list.exportCsv')}
              filename={`students-${toIsoDate(new Date())}.csv`}
              buildRows={async () => {
                const [students, fields] = await Promise.all([
                  fetchFilteredStudents(groupId),
                  listFieldDefinitions(),
                ]);
                return studentsCsvRows(students, fields);
              }}
            />
          )}
          <ExportLink
            prefill={{
              students: groupId ? { mode: 'group', groupId } : undefined,
            }}
          />
        </div>
        <StudentsTable
          search={search}
          page={page}
          onPageChange={setPage}
          groupId={groupId || null}
        />
      </section>
    </main>
  );
}

export default StudentsPage;
