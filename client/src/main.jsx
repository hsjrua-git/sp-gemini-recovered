import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import { AuthProvider } from './auth/AuthProvider.jsx';
import { applyRememberedTheme } from './lib/theme.js';
import { PreferencesProvider } from './preferences/PreferencesProvider.jsx';
// Initializes the i18next instance (with the remembered language draft) and
// syncs <html lang/dir> before anything renders.
import './i18n/index.js';
import './index.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import CustomCursor from './components/CustomCursor.jsx';
import { applyRememberedFont } from './lib/fonts.js';

applyRememberedFont();

applyRememberedTheme();

function signOutOn401(error) {
  if (error?.status === 401) {
    queryClient.setQueryData(['me'], null);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: signOutOn401 }),
  mutationCache: new MutationCache({ onError: signOutOn401 }),
  defaultOptions: {
    queries: {
      // Treat fetched data as fresh for 30s. Without this, react-query's default
      // staleTime of 0 refetches on every component mount and every window
      // refocus — a lot of needless traffic for data that changes slowly. After
      // a mutation we still invalidate the affected keys explicitly, so edits
      // show up immediately regardless of staleTime.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // A tab-switch shouldn't re-hit the server for data that is still fresh;
      // staleTime already gates this, and explicit invalidation covers writes.
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        error?.status === undefined && failureCount < 1,
    },
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <BrowserRouter>
          <AuthProvider>
            <PreferencesProvider>
              <App />
              <CustomCursor />
            </PreferencesProvider>
          </AuthProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </QueryClientProvider>
  </StrictMode>
);
