# Recovery completion — 2026-10-31

## Fixed

- Recovered selected snapshot-2 interface improvements on foundation `9167d99`:
  operational Home Overview, bounded 2D/3D charts, transparent glass palettes,
  locally bundled Persian font choices, and compact management forms.
- Preserved hidden evaluation drafts, added repeatable invalid-input navigation,
  repaired drawer focus and late-loading transitions, and fixed the narrow
  Evaluate selector and English accounting-report tab overflows.
- Added root build-before-start orchestration for the real Express application.

## Verification and remaining

501 unit/core/client/agent tests and 6 separate PostgreSQL permission tests
passed; client lint/build and all 37 PGlite migrations/checks passed. Swept 31
routes at 1280/768/390px in Persian/dark and 390px in English/light, with passing
retests for the two responsive defects. Original files and all 37 foundation
migrations were preserved. [Recovery record and screenshots](docs/recovery-preview-2026-10-31.md).

Historical policy deferrals, full PostgreSQL concurrency certification for this
recovery, and physical-device checks remain outside this verification scope.

---

# Release repair — 2026-10-30

## Fixed

- Reproduced task/template HTTP 500s caused by the normal database being two
  migrations behind. Backed up, restore-tested, then applied 036/037 locally with
  authorization; original data across 40 tables was preserved.
- Added migration-aware health/API readiness checks and translated upgrade/outage
  messages, with regressions for pre-session blocking and automatic recovery.

## Verification and remaining

502 tests and 50 smoke assertions passed; 59 authenticated reads passed on each
of three configurations. The normal app's 32-route browser sweep found no errors
or overflow. [Release record](docs/release-2026-10-30-sp-gemini-2.md).
Earlier A09/A12/A23/A24 policy deferrals and documented performance/device limits
remain; the historical blanket closure below does not supersede that record.

---

# Findings — final independent audit disposition (2026-10-29)

The 2026-10-25 material below is retained as a historical record, but its
claims and test counts are superseded by the independent OpenCode re-audit in
`docs/audit-2026-10-28-sp-gemini-1-opencode.md`.

All confirmed critical-through-minor product findings are now remediated. In
particular, migrations 031–035 harden real-PostgreSQL races/accounting and apply
the authoritative schema-4 academic lifecycle: a session receives persisted
`period_id` membership only after its first answer, empty selected cells do not
consume a slot, and detach/reactivation/analysis/alerts are database-maintained.
The application-only auth, custom-field, cafe, accounting, agent, preferences,
and two-comment extensions remain intact.

Release verification covered a fresh isolated PostgreSQL schema through all 35
migrations, connected all-module seed and clean removal; 141 server tests (135
pass + 6 integration-gated), 55 PGlite core tests, 214 client tests, 21 agent
tests, all 6 permission integrations, 52 API reads, real two-connection race
checks, accounting/cafe/alert/agent smokes, client lint/build, Capacitor Android
add/sync, a real compressed backup, and every SPA route at the harness's 454 px
minimum width. The remaining environment limits—not product defects—are signed
APK/iOS compilation, physical audio/model quality, manual screen-reader/browser
matrix testing, and long soak/load testing.

---

# Historical findings — 2026-10-25

## Fixed

1. **App could not boot** — `validation/cafeInventory.js` imported
   `./ids.js` (should be `../lib/ids.js`); `npm start` died. Root cause:
   tests never boot the full app.
2. **POS student endpoints 500'd** — `routes/cafeBalances.js` +
   `routes/cafeSales.js` selected `students.code`; the column is
   `student_code`. Every student search / student sale failed at runtime.
3. **Cafe purchases list 500'd when filtered** — the route built `$1/$2`
   placeholders but never passed the values array (the UI always sends
   from/to).
4. **Cafe inventory 500'd** — `ORDER BY lower(productName)` used a SELECT
   alias inside an expression, which Postgres rejects.
5. **RTL horizontal overflow (10k px of document scroll)** — the skip-link's
   physical `left: -9999px` is inside RTL's scrollable overflow direction.
   Now `inset-inline-start`, with the mirrored focus state.
6. **Wrong landing after forced password change** — hardcoded
   `navigate('/students')`; now `firstAllowedPath(can)` (Administrators land
   on the dashboard, verified live).
7. **Mobile horizontal overflow** — `.row` now wraps (sessions generate card
   at 390px), and wide tables (accounting mappings) scroll inside their
   `section-card` on narrow screens instead of widening the document.
8. **Repo hygiene** — personal/reference material untracked but kept on disk
   (`Mine/`, `helpful/`, `student-panel-tutoring/`, notes, ER diagram,
   `answers.md`, `evaluation database`, `backups/` incl. a Sep DB dump), the
   empty root `package.json`/lock untracked (their .gitignore rules predated
   their tracking), and the `student-panel-compacted` submodule pointer
   committed at its rebuilt commit.
9. **Dead code deleted** — `src/App.css` (self-documented Vite leftover),
   `src/components/HeadlineCards.jsx` (superseded by CompletionHub),
   `src/auth/roles.js` (unreferenced). Kept: `api/local.js` +
   `db/bootstrap.js` (documented mobile/PGlite path).
10. **DRY pass on the front end** — new `lib/money.js` (formatWhole/
    formatAmount/parseWholeNumber/parseQuantity, unit-tested) replaces the
    eight per-page money formatters and ten per-page input parsers;
    `startOfJalaliMonth` moved into `lib/locale.js` (was copied in four
    pages); the duplicated `StatCard` extracted to `components/`. Pages now
    import shared helpers — full lint (zero warnings), 197/197 client tests,
    build green.
11. **New guards so this class of bug cannot hide again:**
    `agent/scripts/apiSmoke.mjs` logs in and GETs all 43 read endpoints with
    the queries their own UIs send (43/43 OK), and the voice agent's live
    smoke exercises real HTTP login/sale/void end to end.

## Dispositioned (no change needed)

- **three.js (544 KB chunk)** — intentional: CohortConstellation is a
  hand-built WebGL hero (drag-orbit, depth-fade, hover picking), lazy-loaded
  into its own chunk only when motion + WebGL are available. Not redundancy.
- **Sidebar rail starts collapsed on desktop** — a documented design default
  (`ref 5's slim-rail default` in Layout.jsx), toggleable per session.
- **Satellite «0/31» labels** — render within their 44 px boxes (verified:
  no clipping); the tour screenshot was low-resolution, not an overflow.
- **Topbar title** — correct on load and after reload; no lag reproduced
  after the fixes above (earlier screenshot was a stale bundle).

## Superseded follow-ups

- The old tour-only `demo` account/credential is not part of this repository or
  the final fixture. Development sample users are scoped and removable.
- The route/error-boundary/title/focus/overflow sweep was repeated in the final
  audit; the harness reached 454 px. Manual screen-reader and cross-browser
  testing remains an environment limitation, not a claimed verification.
- The Persian Evaluate heading now matches the navigation wording «ثبت نمرات».

---

# Nav redesign + AI panel — 2026-10-25 (second pass)

Finished the interrupted nav-redesign chat and shipped the AI panel. The
interrupted chat had left the tree **unbuildable**: the rewritten
`navigation.js` dropped `EXTRA_TITLES`/`extraTitleForPath` which `Layout.jsx`
still imports, and none of the new panel classes (`nav-flat`, `panel-*`)
existed in `index.css` yet. Both restored/completed here.

## Shipped

1. **Two-level sidebar** (approved design): the expanded rail lists the five
   panels (Evaluation / Cafe / Accounting / AI / Administration, user's
   grouping); selecting one swaps the sidebar to that panel's pages with a
   «همه بخش‌ها» back control; landing on any page deep-link opens its panel
   automatically (render-time adjust, no effect). The collapsed icon rail
   stays flat exactly as before. Old `<details>` group CSS removed.
2. **AI panel** — migration 028 (`agent.view`, no prerequisite, seeded to
   Administrator; applied to the live DB), `routes/agent.js` (`/api/agent/
   status` + `/api/agent/transcripts`, both `agent.view`-gated, filters
   validated, 100-turn cap with `truncated`), client pages
   `AgentPage` (kiosk footprint + setup checklist pairing the data with
   agent/README.md steps; the running-process step is honestly "manual")
   and `AgentTranscriptsPage` (session/role/date filters, dir="auto" text,
   audio-kept badge, meta expander), born bilingual (`agent.json` fa/en).
3. **i18n**: `nav.json` `sections` → `panels` (+ `allPanels`, items.agent /
   items.transcripts) in both languages; `admin.json` `permissionGroups.AI`
   (Roles page renders «هوش مصنوعی» / "AI").
4. apiSmoke now covers the two agent endpoints (45 endpoints, all OK).

## Found during the visual tour (fixed in place)

5. **Specificity**: `.transcript-how { white-space: normal }` lost to
   `.table-wrap td`'s nowrap — the setup checklist overflowed its card and
   pushed the status badges off-screen. Re-scoped at `.table-wrap` depth.
6. **The global `.table-wrap table { min-width: max-content }` floor** then
   still defeated the wrap (long how-to lines forced a horizontal scrollbar).
   These two tables now shrink (`:has(.transcript-…)` override).
7. **Double active highlight**: in the panel view, NavLink's prefix matching
   lit BOTH AI pages on `/agent/transcripts`. The panel view now highlights
   the longest item path that prefixes the location (the collapsed rail keeps
   its exact-match rule).

## Verified

Client lint + 197/197 tests + build; server 183 pass / 4 skipped
(integration gated); apiSmoke 45/45; live tour as Administrator in fa + en,
desktop + mobile drawer: panel list, swap, back, auto-active on deep links,
both AI pages (live Jalali timestamps, checklist badges), Roles group label.
Tour artifacts (throwaway user, seeded transcript turns) removed afterwards.

# Schema-4 adoption — evaluations rebuilt (quality/quantity, session-tied)

The richer reference design (the `student_panel` DB revision of schema-4) fully
replaced the old period model. One big-bang migration (029; data wiped and
reseeded) plus a full app adaptation across server, client and the test-only
PGlite mirror.

## The new model

- An evaluation ROW is a selected cell: session × parameter × target (a
  member, or the whole group via `membership_id NULL` — NULLS NOT DISTINCT).
  It carries independently-nullable ranged integers **quality** and
  **quantity** (each with its own ≤500-char comment) and `locks_at`. A stored
  row IS the expectation; both values NULL = "selected, unanswered". Saving
  `selected: false` deletes the row.
- Periods are per ASSIGNMENT: a session attaches on its first active answer,
  four answered active sessions fill a period, and it detaches when inactive or
  when its final answer disappears. Empty selected cells do not occupy a slot.
  The school-wide anchor and `parameter_changes` are gone.
- Locking re-anchored to the session date (7d current/future, 1d past);
  override keeps the written-reason + audit flow.
- Parameters: unique code replaces unit; integer min/max shared by both
  dimensions; range-narrowing guard (trigger + friendly pre-check).
- Audit rows carry `old_data`/`new_data` snapshots; the scores.save entry
  names the session.
- Applicability = explicit cell selection; dashboard "expected" = selected
  cells (whole-group rows expand per member; a member's own row shadows).

## Bugs the port caught (fixed)

- `loadTargets` read `assignment.membershipId` off a row aliased
  `assignmentMembershipId` — saving evaluations for INDIVIDUAL assignments
  always failed "target is not part of the assignment" (route + mirror).
- Export cube: CTE columns referenced under the wrong quoted aliases, and the
  scope filters ran in the outer WHERE over `expanded` (missing FROM-clause
  entry). Every /api/export/cube request 500'd until both were fixed.
- Seed: roster rows were stored as `{id}` but consumed as `membershipId` —
  every member cell collapsed onto the whole-group key.
- `listAssignmentPeriods` leaked raw Date objects where the app contract is
  `YYYY-MM-DD` strings (now cast ::text).

## Deliberate calls

- The student page's inline evaluation section (period-era entry grid) is
  REMOVED — all entry is session-first on the Evaluate page; the student page
  keeps read-only history (timeline by session / by assignment-period / by
  parameter, dimension-aware).
- Dashboard hero + 3D constellation render from ONE assignment-period grid
  (the new model's unit) with a persisted customization: assignment, period,
  dimension (کیفیت/کمیت) and the "answered" basis (value vs value-or-comment).
  Cross-assignment shape comes from the trends panel.
- The export center's tracking-log include is gone with `parameter_changes`;
  the scope is assignment/date-range/seq based and the whole export reads one
  dimension.
- Settings page loses the anchor card (no global calendar anymore).
- Blind entry (scores.enter without scores.view): the Evaluate grid never
  fetches saved values for such roles; the server still enforces everything.

## Verified

Server: 192 tests green (188 pass / 4 gated skips) incl. the fully ported
core/services PGlite mirror; apiSmoke 50/50 on the live seeded server.
Client: lint clean, 204/204 vitest, production build. Seed lights the
constellation: 6 parameters, 2 groups/30 students, 4 assignments, 41
sessions, 12 periods, 336 cells (264 answered).

## Found during the live tour (fixed in place)

8. **EvaluatePage TDZ crash**: `savedQuery` read `effectiveSessionId`
   before its declaration — instant ErrorBoundary on load. Hoisted the
   derivation above the query.
9. **No default assignment**: the page waited on an explicit assignment
   selection while the select cosmetically showed the first one, so sessions
   never loaded ("no sessions for this assignment" with 41 seeded). Now the
   first assignment is derived, like the session default.
10. **`RangeError: Invalid time value`**: the sessions API returns full
    timestamps; `formatBothDates` splits date-only strings. Session dates are
    trimmed to `YYYY-MM-DD` at the call sites (Evaluate + Import).
11. **Selecting a cell did nothing**: `pruneDraft` treated a fresh
    selected-unanswered cell as a no-op, but the row IS the expectation —
    selecting it must create it. Kept as a change (test updated).
12. **Save sent `sessionId: null`**: `handleSave` used the raw state instead
    of the derived default. (Found by intercepting the PUT payload.)
13. **Raw i18n key** `evaluate.noteAriaLabel` rendered as the note editor's
    label — I had pruned it as dead; restored (it was in the kept-supersets
    list for a reason).
14. **Stale shell after redeploys**: the SPA fallback sent `index.html`
    without cache headers, so Chrome heuristically cached it (~8h of stale
    bundles). Now `Cache-Control: no-cache`.
15. **Results/Audit crashed on the group row**: `formatStudentCode(null)` /
    `change.student` null — the whole-group row carries no student. Guarded,
    and the audit changes table now renders the new cell snapshots
    (quality / quantity pairs, "cell removed", whole-group label).
16. **Dashboard options didn't persist**: the server's preferences
    whitelist rejected the new `dashboardConstellation` key. Added the
    validator + default (server suite still 188/0).

Tour-verified in Persian on the live seeded app: login → forced password
change → evaluate (select cell, quality 88 + quantity 90 + quality note,
saved, "1 خانه تغییر کرد", lock hints, blind-entry hint logic), results
(assignment → period 2 with 30 answered, dimension toggle, group row),
dashboard (field-of-view panel, period switch persisted, CompletionHub hero
with per-student states + coverage rings; IAB has no WebGL so the 3D path
took its documented fallback), audit (session-based sentences + expanded
old/new snapshot table). Tour artifacts (zz-tour user + audit rows) removed.
