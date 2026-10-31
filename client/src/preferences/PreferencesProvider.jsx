import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getPreferences,
  resetPreferences,
  savePreferences,
} from '../api/preferences.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { setLanguage } from '../i18n/index.js';
import { applyPalette, applyTheme } from '../lib/theme.js';
import { applyPersianFont } from '../lib/fonts.js';
import { DEFAULT_PREFERENCES } from './defaults.js';
import { PreferencesContext } from './PreferencesContext.jsx';

const KEY = ['preferences'];

// Loads the signed-in user's preferences, applies their theme, and exposes
// optimistic `update`/`reset` mutations. The context object and the
// usePreferences() hook live in PreferencesContext.jsx; keeping this provider
// component in its own file is what lets Fast Refresh work cleanly.
export function PreferencesProvider({ children }) {
  const { t } = useTranslation('common');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enabled = user !== null && !user.mustChangePassword;

  const query = useQuery({
    queryKey: KEY,
    queryFn: getPreferences,
    enabled,
    retry: false,
  });
  const preferences = query.data ?? DEFAULT_PREFERENCES;
  const ready = !enabled || query.isSuccess || query.isError;

  const theme = query.data?.theme;
  const persianFont = query.data?.persianFont;
  useEffect(() => {
    if (persianFont) applyPersianFont(persianFont);
  }, [persianFont]);
  useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  const palette = query.data?.palette;
  useEffect(() => {
    if (palette) applyPalette(palette);
  }, [palette]);

  // The stored preference is authoritative once it arrives; setLanguage also
  // refreshes the pre-login draft so the next visit boots in the same
  // language. Like the theme, an absent value keeps the boot-time choice.
  const language = query.data?.language;
  useEffect(() => {
    if (language) setLanguage(language);
  }, [language]);

  const update = useMutation({
    mutationKey: KEY,
    mutationFn: savePreferences,
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: KEY });
      const previous = queryClient.getQueryData(KEY);
      const base = previous ?? DEFAULT_PREFERENCES;
      const next = {
        ...base,
        ...changes,
      };
      if (changes.dashboardConstellation) {
        next.dashboardConstellation = {
          ...base.dashboardConstellation,
          ...changes.dashboardConstellation,
        };
      }
      queryClient.setQueryData(KEY, next);
      return { previous };
    },
    onError: (error, changes, context) => {
      if (context?.previous) queryClient.setQueryData(KEY, context.previous);
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: KEY });
      }
    },
  });

  const reset = useMutation({
    mutationFn: resetPreferences,
    onSuccess: (saved) => queryClient.setQueryData(KEY, saved),
  });

  const value = { preferences, update, reset };

  return (
    <PreferencesContext.Provider value={value}>
      {ready ? (
        children
      ) : (
        <main>
          <p>{t('status.loading')}</p>
        </main>
      )}
    </PreferencesContext.Provider>
  );
}
