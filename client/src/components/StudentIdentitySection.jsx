import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { updateStudent } from '../api/students.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { errorMessage } from '../i18n/errors.js';
import { formatIsoDate } from '../lib/format.js';
import JalaliDatePicker from './JalaliDatePicker.jsx';
import { toLatinDigits } from '../lib/locale.js';

// The built-in identity fields (gender, birth date, father name, national ID)
// live on the students table itself, unlike the admin-defined custom fields
// below them. Display + edit mirror StudentFieldsSection.
function StudentIdentitySection({ student }) {
  const { t } = useTranslation(['students', 'common', 'workflows']);
  const queryClient = useQueryClient();
  const { can } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [gender, setGender] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [problem, setProblem] = useState(null);

  const save = useMutation({
    mutationFn: (fields) => updateStudent(student.id, fields),
    onSuccess: () => {
      setIsEditing(false);
      queryClient.invalidateQueries({ queryKey: ['student', student.id] });
      queryClient.invalidateQueries({ queryKey: ['students'] });
    },
  });

  function startEditing() {
    setGender(student.gender ?? '');
    setBirthDate(student.birthDate ?? '');
    setFatherName(student.fatherName ?? '');
    setNationalId(student.nationalId ?? '');
    setProblem(null);
    save.reset();
    setIsEditing(true);
  }

  function handleSubmit(event) {
    event.preventDefault();
    if (!gender || !birthDate || !fatherName.trim() || !nationalId) {
      setProblem(t('workflows:identity.required'));
      return;
    }
    if (!/^[0-9]{10}$/.test(nationalId)) {
      setProblem(t('detail.nationalIdProblem'));
      return;
    }
    setProblem(null);
    save.mutate({ gender, birthDate, fatherName, nationalId });
  }

  return (
    <section className="section-card">
      <h2>{t('detail.identityTitle')}</h2>
      {['gender', 'birthDate', 'fatherName', 'nationalId'].some(key => !student[key]) && <p className="hint">{t('workflows:identity.incomplete')}</p>}
      {isEditing ? (
        <form onSubmit={handleSubmit}>
          <label htmlFor="student-gender">{t('detail.gender')}</label>
          <select
            id="student-gender"
            required
            value={gender}
            onChange={(event) => setGender(event.target.value)}
            disabled={save.isPending}
          >
            <option value="">{t('detail.notSet')}</option>
            <option value="male">{t('detail.male')}</option>
            <option value="female">{t('detail.female')}</option>
          </select>

          <label htmlFor="student-birth-date">{t('detail.birthDate')}</label>
          <JalaliDatePicker
            id="student-birth-date"
            required
            value={birthDate}
            onChange={setBirthDate}
            disabled={save.isPending}
          />

          <label htmlFor="student-father-name">{t('detail.fatherName')}</label>
          <input
            id="student-father-name"
            required
            minLength={2}
            value={fatherName}
            onChange={(event) => setFatherName(event.target.value)}
            maxLength={100}
            autoComplete="off"
            disabled={save.isPending}
          />

          <label htmlFor="student-national-id">{t('detail.nationalId')}</label>
          <input
            id="student-national-id"
            required
            value={nationalId}
            onChange={(event) => setNationalId(toLatinDigits(event.target.value))}
            inputMode="numeric"
            pattern="[0-9]{10}"
            maxLength={10}
            autoComplete="off"
            disabled={save.isPending}
          />

          <div className="row">
            <button type="submit" disabled={save.isPending}>
              {save.isPending ? t('common:actions.saving') : t('detail.saveIdentity')}
            </button>
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              disabled={save.isPending}
            >
              {t('common:actions.cancel')}
            </button>
          </div>
          {problem && (
            <p className="error" role="alert">
              {problem}
            </p>
          )}
          {save.isError && (
            <p className="error">{errorMessage(save.error)}</p>
          )}
        </form>
      ) : (
        <>
          <dl className="field-list">
            <div className="field-list-row">
              <dt>{t('detail.gender')}</dt>
              <dd>
                {student.gender
                  ? student.gender === 'male'
                    ? t('detail.male')
                    : t('detail.female')
                  : '—'}
              </dd>
            </div>
            <div className="field-list-row">
              <dt>{t('detail.birthDate')}</dt>
              <dd>
                {student.birthDate ? formatIsoDate(student.birthDate) : '—'}
              </dd>
            </div>
            <div className="field-list-row">
              <dt>{t('detail.fatherName')}</dt>
              <dd>{student.fatherName ?? '—'}</dd>
            </div>
            <div className="field-list-row">
              <dt>{t('detail.nationalId')}</dt>
              <dd>{student.nationalId ?? '—'}</dd>
            </div>
          </dl>
          {can('students.edit') && (
            <button type="button" onClick={startEditing}>
              {t('detail.editIdentity')}
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default StudentIdentitySection;
