// User preferences — service layer (framework-free).
//
// PGlite test mirror of routes/preferences.js. The route keyed everything on
// req.user.id; here there is one user, resolved by ensureLocalUser() at startup,
// read through getLocalUserId(). Body validation stays in lib/preferences.js;
// parse failures become ServiceError.validation.
//
// user_preferences.user_id is a NOT NULL FK to users(id), so ensureLocalUser()
// MUST have run first (at app startup, and in any test that touches this).

import { getDb } from '../db.js';
import { ServiceError } from '../errors.js';
import { getLocalUserId } from '../context.js';
import {
  mergePreferences,
  parsePreferencesUpdate,
} from '../../lib/preferences.js';

async function withDefaults(db, stored) {
  const result = await db.query('SELECT settings FROM preferences WHERE id=1');
  return mergePreferences(stored, result.rows[0]?.settings);
}

// Read the stored preferences, filled in with defaults.
export async function getPreferences() {
  const db = getDb();
  const result = await db.query(
    'SELECT settings FROM user_preferences WHERE user_id = $1',
    [getLocalUserId()],
  );
  return { preferences: await withDefaults(db, result.rows[0]?.settings) };
}

// Merge a partial settings patch into the stored preferences.
export async function updatePreferences(body) {
  const db = getDb();
  const parsed = parsePreferencesUpdate(body);
  if (parsed.error) throw ServiceError.validation(parsed.error);

  const result = await db.query(
    `INSERT INTO user_preferences (user_id, settings)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (user_id)
     DO UPDATE SET settings =
       CASE WHEN EXCLUDED.settings ? 'dashboardConstellation' THEN
         (user_preferences.settings || EXCLUDED.settings)
         || jsonb_build_object(
              'dashboardConstellation',
              COALESCE(
                user_preferences.settings -> 'dashboardConstellation',
                '{}'::jsonb
              ) || (EXCLUDED.settings -> 'dashboardConstellation')
            )
       ELSE user_preferences.settings || EXCLUDED.settings
       END,
                    updated_at = now()
     RETURNING settings`,
    [getLocalUserId(), JSON.stringify(parsed.values)],
  );
  return { preferences: await withDefaults(db, result.rows[0].settings) };
}

// Forget the stored preferences (falls back to defaults).
export async function resetPreferences() {
  const db = getDb();
  await db.query('DELETE FROM user_preferences WHERE user_id = $1', [
    getLocalUserId(),
  ]);
  return { preferences: await withDefaults(db, {}) };
}
