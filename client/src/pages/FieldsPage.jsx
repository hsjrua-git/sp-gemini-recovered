import { useState } from 'react';
import CreateSection from '../components/CreateSection.jsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.jsx';
import EmptyState from '../components/EmptyState.jsx';
import {
  archiveFieldDefinition,
  createFieldDefinition,
  listFieldDefinitions,
  updateFieldDefinition,
} from '../api/fields.js';
import { errorMessage } from '../i18n/errors.js';

const FIELD_TYPES = [
  'text',
  'long_text',
  'number',
  'date',
  'yes_no',
  'choice',
];

function NewFieldForm() {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [fieldType, setFieldType] = useState('text');
  const [choicesText, setChoicesText] = useState('');
  const [isRestricted, setIsRestricted] = useState(false);

  const create = useMutation({
    mutationFn: createFieldDefinition,
    onSuccess: () => {
      setLabel('');
      setChoicesText('');
      setIsRestricted(false);
      setFieldType('text');
      queryClient.invalidateQueries({ queryKey: ['field-definitions'] });
    },
  });

  function handleSubmit(event) {
    event.preventDefault();
    const choices =
      fieldType === 'choice'
        ? choicesText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
    create.mutate({ label, fieldType, choices, isRestricted });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="form-grid">
        <label>
          {t('fields.label')}
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            maxLength={60}
            autoComplete="off"
          />
        </label>
        <label>
          {t('fields.type')}
          <select
            value={fieldType}
            onChange={(event) => setFieldType(event.target.value)}
          >
            {FIELD_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`fields.types.${value}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {fieldType === 'choice' && (
        <label>
          {t('fields.choices')}
          <textarea
            value={choicesText}
            onChange={(event) => setChoicesText(event.target.value)}
            rows={4}
          />
        </label>
      )}
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={isRestricted}
          onChange={(event) => setIsRestricted(event.target.checked)}
        />
        <span>{t('fields.restricted')}</span>
      </label>
      <p className="hint">{t('fields.typeHint')}</p>
      <button type="submit" disabled={create.isPending || label.trim() === ''}>
        {create.isPending ? t('fields.adding') : t('fields.submit')}
      </button>
      {create.isError && (
        <p className="error" role="alert">
          {errorMessage(create.error)}
        </p>
      )}
    </form>
  );
}

function FieldRow({ field }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['field-definitions'] });

  const update = useMutation({
    mutationFn: (fields) => updateFieldDefinition(field.id, fields),
    onSuccess: invalidate,
  });
  const archive = useMutation({
    mutationFn: () => archiveFieldDefinition(field.id),
    onSuccess: invalidate,
  });

  return (
    <tr>
      <td>{field.label}</td>
      <td>
        {t(`fields.types.${field.fieldType}`, {
          defaultValue: field.fieldType,
        })}
      </td>
      <td>
        {field.fieldType === 'choice' ? field.choices.join(', ') : '—'}
      </td>
      <td>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={field.isRestricted}
            onChange={(event) =>
              update.mutate({ isRestricted: event.target.checked })
            }
            disabled={update.isPending}
          />
          <span className="hint">{t('fields.restrictedShort')}</span>
        </label>
      </td>
      <td className="actions">
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (
              window.confirm(t('fields.archiveConfirm', { label: field.label }))
            ) {
              archive.mutate();
            }
          }}
          disabled={archive.isPending}
        >
          {t('common:actions.archive')}
        </button>
        {(update.isError || archive.isError) && (
          <p className="error" role="alert">
            {errorMessage(update.error ?? archive.error)}
          </p>
        )}
      </td>
    </tr>
  );
}

function FieldsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const { can } = useAuth();
  const query = useQuery({
    queryKey: ['field-definitions'],
    queryFn: () => listFieldDefinitions(),
  });

  if (!can('fields.manage')) {
    return (
      <main>
        <EmptyState
          title={t('fields.readOnlyTitle')}
          description={t('fields.readOnlyDescription')}
        />
      </main>
    );
  }

  return (
    <main className="wide">
      <h1>{t('fields.title')}</h1>
      <p className="hint">{t('fields.hint')}</p>

      <CreateSection title={t('fields.addTitle')}>
        <NewFieldForm />
      </CreateSection>

      <section className="section-card">
        <h2>{t('fields.listTitle')}</h2>
        {query.isPending && (
          <p className="hint">{t('common:status.loading')}</p>
        )}
        {query.isError && <p className="error">{errorMessage(query.error)}</p>}
        {query.data && query.data.length === 0 && (
          <p className="hint">{t('fields.empty')}</p>
        )}
        {query.data && query.data.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('fields.colLabel')}</th>
                  <th>{t('fields.colType')}</th>
                  <th>{t('fields.colChoices')}</th>
                  <th>{t('fields.colVisibility')}</th>
                  <th>{t('common:table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((field) => (
                  <FieldRow key={field.id} field={field} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export default FieldsPage;
