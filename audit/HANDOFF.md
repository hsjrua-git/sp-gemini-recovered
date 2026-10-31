# Handoff Prompt — sp-gemini-1 Local Audit (Stage 1 → Stage 2)

## 1. GOAL

Continue an evidence-backed local audit of `/home/hsjrua/Documents/sp-gemini-1`
(student-panel: Express 5 API + React 19 SPA + voice kiosk + deploy scripts).

**Required deliverables**
- `audit/AUDIT_REPORT.md` — every finding with exact location, evidence,
  severity, VERIFIED/LIKELY/SUSPECTED status, effort, AUTO/ASK disposition.
- `audit/FIX_LOG.md` — created in Stage 2, one entry per fix.
- `audit/checks/` — retained, runnable reproductions.
- `audit/baseline/` — saved command output plus exit metadata.
- `audit/TEST_QUALITY.md` — every existing test rated USEFUL, WEAK, USELESS, or WRONG.
- Separate local commits per finding or tight group.

**Two stages**
- **Stage 1 (current, incomplete):** read-only outside `audit/`. Fully read every
  source file and test, verify real workflows end-to-end, record coverage gaps.
- **Stage 2 (not started):** new `audit-fixes` branch, `FIX_LOG.md`, fix AUTO
  findings in severity order, full checks before/after, separate commits of
  named paths. Skip ASK findings and continue.

**Latest request:** only a "live" check and this handoff file; no new feature scope.
The next action is the Stage 1 step in §6.

**Acceptance:** every claim reproducible from retained evidence; nothing marked
VERIFIED without a run; lint/tests/build before and after fixes; clean committed
checkpoint if stopping early; **never publish**.

## 2. INSTRUCTIONS AND DECISIONS

**Hard constraints (user-stated)**
- Local files are authoritative. Upstream
  `https://github.com/hsjrua-git/sp-gemini-1` is reference only.
  **Never clone, pull, push, change remotes, deploy, or publish.**
- Stage 1: no edits outside `audit/`. Dependency installs allowed; preserve lockfiles.
- Read a script before running it; mutate only the isolated seeded DB; never
  disclose real secrets beyond four characters.
- Do not touch files outside the project or install global packages.
- Skip approval-dependent work and record it as ASK: schema changes, public
  behavior/API changes, major upgrades, large rewrites, feature removal,
  uncertain deletions, license changes.
- Preserve `partly-schema/` — untracked user work.

**Agreed decisions**
- Isolated PostgreSQL `127.0.0.1:55439/student_panel_audit`; audited API
  `127.0.0.1:3300`. Leave the unrelated server on port 3000 alone.
- Use the pinned connection in `audit/checks/isolated.mjs`. The PostgreSQL MCP
  server points at a *different* database (`127.0.0.1:5432/sp_gemini_1_audit`);
  never mutate through it.
- Run shared-database mutation checks **serially**. Concurrent accounting/kiosk
  probes caused confirmed harness interference.
- Void-protocol redesign (A09) is ASK, not AUTO.
- Read `AGENTS.md` first: it requires Context7 for library APIs, live schema
  inspection before DB code, lint/tests/build before "done", and never
  committing `server/.env`.

**Rejected / failed approaches**
- Concurrent smoke runs: `baseline/smoke-accounting.txt` failed with
  `241000 !== 229000` because a kiosk sale interleaved. The serial rerun passed.
  Not a product defect; do not re-run these concurrently.
- Android tests were read but not run (no device/emulator).
- No project type-check script or config exists.

## 3. VERIFIED CURRENT STATE

- Path `/home/hsjrua/Documents/sp-gemini-1`; branch `main`; HEAD
  `a4d81f07d2e016341310dc8df79b9c878cf32ada`; tracking `origin/main`.
- `git status --short --branch`: **only** `?? audit/` and `?? partly-schema/`.
  No application source modified, nothing committed, nothing pushed.
- `partly-schema/` = 3 untracked files, 1,931 lines (`schema-4.sql`,
  `schema-4.dbml`, `schema-4-security.sql`). User work; preserve it.
- Isolated services are currently **down** (verified: no listeners on 55439 or
  3300; only unrelated `:3000`). Restart:
  - DB: `/usr/lib/postgresql/16/bin/pg_ctl -D audit/runtime/pgdata -o "-h 127.0.0.1 -p 55439 -k $PWD/audit/.tmp/pgsocket" -l audit/runtime/postgres.log start`
  - API: `node audit/start-server.mjs > audit/runtime/server.txt 2>&1 &`
  - Health: `curl -s http://127.0.0.1:3300/api/health`
  `start-server.mjs` pins the DB URL, host/port, production mode, Origin checks,
  and a random secret; it ignores the project `.env`.
- Architecture: `server/` Express 5 + PostgreSQL (35 migrations, trigger-guarded
  ledgers, bigint Toman, `numeric(12,3)` quantities) with a PGlite mirror;
  `client/` React 19 + Vite 8 + react-router 8 + react-query 5 + Vitest;
  `agent/` zero-dependency bilingual kiosk; `deploy/` systemd + backup/restore.
- Dependencies are installed (`npm ci --ignore-scripts`); lockfiles unchanged.
- Inventory: 631 files; 197 files / 29,229 text lines recorded `review:
  "fully read"` in `audit/inventory.json`. Record more with
  `node audit/record-review.mjs current <paths...>`.
- `audit/TEST_QUALITY.md` rates 65 automated test files (24 server, 25 client,
  3 agent, 11 PGlite core, 2 Android).
- Audit artifacts: `AUDIT_REPORT.md` (A01–A11), `TEST_QUALITY.md`,
  `inventory.json`, `record-review.mjs`, `run-command.mjs`, `start-server.mjs`,
  `scan.json`, `baseline/` (75 files), `checks/` (11 scripts), and ignored
  `runtime/`, `.tmp/`, `.npm-cache/`.
- Seed fixtures: users `sample-admin/staff/viewer/accountant/kiosk`; the sample
  password is in `audit/checks/isolated.mjs` (do not paste it into reports).
- The isolated DB holds probe fixtures and append-only rows; counts differ from
  the seed (30 students, 6 parameters, 5 assignments, 71 sessions, 13 answered
  periods, 573 cells).

## 4. FINDINGS AND EVIDENCE

All in `audit/AUDIT_REPORT.md`; output in `audit/baseline/`. Reproduce with
`node audit/run-command.mjs baseline <name> . node audit/checks/<script>.mjs`.

- **A01 HIGH VERIFIED / AUTO** — `deploy/backup.sh:38-41` retention pipes
  whitespace-split paths into `xargs rm`. With a spaced `BACKUP_DIR`, a sibling
  file named `backups`, and `KEEP=1`, it exits 0, deletes the unrelated sentinel,
  keeps the expired dump, and leaves 2 dumps. Repro `checks/backup-spaces.mjs`;
  evidence `baseline/backup-spaces.*`.
- **A02 HIGH VERIFIED / AUTO** — concurrent role PATCHes (`server/src/routes/roles.js`,
  `server/src/routes/users.js` guarded-permission transactions) both return 200
  and leave **zero** active holders of `users.manage`/`roles.manage`. Repro
  `checks/role-manager-race.mjs` (table lock at the audit INSERT, after guards).
  Seeded roles restored. Role↔user interleaving still untested.
- **A03 HIGH VERIFIED / AUTO (duplicate submission only)** —
  `agent/src/dialogue.js:243-280` sets `stageGate='open'` then awaits
  `record_sale`; `agent/src/tools.js:207-224` checks the gate. Two concurrent
  confirmations produce two sale requests for one cart. No real duplicate
  financial write performed. Repro `checks/concurrent-confirm.mjs`.
- **A04 MEDIUM VERIFIED / AUTO** — `server/src/middleware/csrf.js:47` compares
  `Buffer.from()` values with `timingSafeEqual`; equal character length with
  unequal UTF-8 byte length throws `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` instead
  of 403. Repro `checks/csrf-unicode.mjs`.
- **A05 LOW VERIFIED / AUTO** — `server/src/routes/cafeSales.js:140` omits
  `balanceAfter` when null, so walk-in responses omit it;
  `agent/src/panel.js:138` tests `=== null` only, and `Number(undefined)` yields
  `NaN`. Repro `checks/walk-in-response.mjs`; audit sale voided.
- **A06 LOW VERIFIED by reading / AUTO for the assertion, deletion ASK** —
  `client/android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java:15-16`
  asserts `4 == 2+2` (USELESS); `ExampleInstrumentedTest.java:24` expects
  `com.getcapacitor.app` while `client/android/app/build.gradle:7` sets
  `app.studentpanel.mobile` (WRONG).
- **A07 HIGH VERIFIED / AUTO** — `server/src/routes/students.js:27-33`
  `loadDefinitions` selects only `archived_at IS NULL`; after archiving a
  restricted field, `stripRestricted` (`server/src/lib/fields.js`) no longer
  denies its ID, so its value appears in detail and list responses to viewers
  lacking `fields.view_restricted`. Repro `checks/archived-field-privacy.mjs`;
  fixture soft-deleted.
- **A08 MEDIUM VERIFIED / AUTO** — `agent/src/kiosk.js:47` builds
  ``new URL(req.url, `http://${req.headers.host}`)``; `Host: [` causes
  `ECONNRESET`, process exit 1, `ERR_INVALID_URL`. Repro
  `checks/kiosk-malformed-host.mjs`.
- **A09 HIGH VERIFIED / ASK** — `agent/src/dialogue.js:189-190` (`case 'void'`)
  calls `void_last_sale` with no gate; `agent/src/tools.js:227` only checks
  `state.lastSale`; `agent/src/intents.js:61` matches `undo` inside negated
  phrases. Stage-2 "undo", stage-3 "do not undo", and a model tool call on
  "hello" each void once. Repro `checks/void-stage-gate.mjs`.
- **A10 MEDIUM VERIFIED / AUTO** — `server/src/routes/cafeInventory.js:166-179`
  sums `qty * avg_cost` in JS float, then `Math.round` + `moneyNumber`. Waste
  `0.145 × 100` posts **14** instead of 15 (stock 0.855). Repro
  `checks/fractional-waste.mjs`; journal entry
  `a11d95fd-9043-4830-af81-d7ce53e98857`. Fix by valuing in SQL numeric, then
  passing the bigint string through `moneyNumber`.
- **A11 MEDIUM VERIFIED / AUTO** — zero-price student sale returns HTTP 500 /
  `23514` (`cafe_balance_charge_negative`). `server/src/lib/cafeSale.js:99-108`
  always charges `-total`, and the void path at `:180-190` always refunds,
  violating the non-zero constraints. Repro `checks/zero-price-student-sale.mjs`.
  Fix: skip a zero-value balance movement in both paths; no schema change.

**Open suspicions (not reproduced — do not mark VERIFIED)**
- Manual refund direction: `server/src/validation/cafe.js:313-318` requires a
  positive refund amount; `server/src/routes/cafeBalances.js:133` passes
  `delta: amount`, increasing the balance, while migration 026 documents
  `balance.refund` as Dr 2100 / Cr 1100 (deposits and cash down) and
  `resetData.js:118` maps it the same way. Balance and ledger likely diverge.
  Repro: top up 100000, refund 30000, compare `/api/cafe/balances/:id` with the
  posted `balance_txn` entry.
- Three-decimal validation: `server/src/validation/cafeInventory.js:21` uses
  `Math.round(qty * 1000) !== qty * 1000`. `0.145` and `2.675` pass, but
  **`1.005` fails** (`1004.9999999999999`), rejecting a valid `numeric(12,3)`
  quantity. Check the sale/purchase parsers for the same pattern.
- Agent: configured STT with an unavailable microphone may log text fallback
  but never start the REPL; providers lack request timeouts.
- Client advisories: 5 affected (high `vite`, `source-map-js`, `zod`; moderate
  `vitest`, `@vitest/mocker`); reachability unreviewed. Server and agent: 0.
  The `baseline/dependencies-*.json` files are run metadata; the audit payload
  is in the matching `.txt`.
- Permission integration assertions can accept 500 as success; the PGlite
  rejection helper accepts arbitrary errors; PGlite mirrors do not prove
  Express behavior. Documented in `TEST_QUALITY.md`.
- Migration 029 destroys prior score/history/view data; historical approval is
  a QUESTION, not permission to rewrite it.
- README says the Accountant role includes fiscal close/chart setup; migration
  026 grants only `accounting.view/enter/post`. Documentation mismatch.
- Prior reports (`docs/audit-notes.md`, `docs/audit-remediation-report.md`,
  `docs/audit-2026-10-28-sp-gemini-1-opencode.md`, `FINDINGS.md`) claim all
  findings remediated. Do not repeat that claim; reconcile against evidence.

## 5. VERIFICATION

Run and saved under `audit/baseline/`:
- Client lint PASS; production build PASS; Vitest **25 files / 214 tests pass**.
- Server unit **135 pass, 6 integration skips**; isolated HTTP integration
  **6/6 pass** (with the assertion limitations above).
- Agent **21 pass**; PGlite core **55 pass**; PGlite verifier **35 migrations +
  invariants pass**; real PostgreSQL migrations **35 applied**.
- Smokes: stock **6**, cafe sale/report **8+5**, alerts **6**, invariant races
  **5**, accounting serial **9** — all pass.
- Browser: real login, all **30 protected routes** at 454 px Persian/RTL — h1
  present, no error boundary, overflow, or error-level console messages;
  `/` → `/dashboard`; unknown route → not-found. `baseline/browser-routes.md`.
- Every A01–A11 reproduction ran and failed meaningfully.

Not run: Android device/instrumentation, real speech/model providers, desktop
focus/layout matrix, long-running load, type-check (none configured), full
dependency exploitability review.

## 6. NEXT ACTIONS

1. **Verify state first:** `git status --short --branch`, confirm HEAD and the
   two untracked paths. Read `AGENTS.md`, `audit/AUDIT_REPORT.md`,
   `audit/TEST_QUALITY.md`, `audit/checks/isolated.mjs`, `audit/run-command.mjs`,
   `audit/start-server.mjs`. Restart the isolated DB and API (§3) and check
   `/api/health`.
2. **Reproduce the manual-refund divergence** via the real API with a synthetic
   student; save output; decide AUTO/ASK. Suspected HIGH if balance and journal
   disagree.
3. **Reproduce the `1.005` quantity rejection** (waste/adjustment and sale
   paths); record severity.
4. **Backup/restore round trip:** run `deploy/backup.sh`/`restore.sh` against a
   disposable isolated database, verify data integrity, gzip validation, and
   transactional failure behavior.
5. **Serial real-workflow checks:** scoring preview/save/no-op/lock/blind-entry,
   import/export, cafe/accounting lifecycle.
6. **Extend A02** to role↔user interleavings; investigate agent fallback and
   missing provider timeouts.
7. **Finish full reads** including `partly-schema/` (3 files, 1,931 lines); record
   with `record-review.mjs`. Update the coverage section of the report.
8. **Reconcile prior audit documents** and dependency reachability; update
   `AUDIT_REPORT.md`.
9. **Close Stage 1**, then commit the `audit/` artifacts on `main` as the
   checkpoint (they are untracked; never add `partly-schema/`; the sample
   password is already tracked source). Create `audit-fixes`, initialize
   `FIX_LOG.md`, and fix AUTO items in severity order: A01, A02, A03, A07, A04,
   A08, A10, A11, A05, A06 — each with a regression check, full verification,
   and a separate local commit of named paths.
10. Leave ASK items documented and untouched: A09 protocol, Android test
    deletion, migration 029. Never push.

Resume safely: `audit/` and `partly-schema/` are the only untracked paths — never
delete or overwrite them. Re-run `run-command.mjs` for repeated checks so
evidence stays current, and do not duplicate already-recorded findings.

Continue the work from this handoff. First read the applicable repository instructions and verify the current filesystem and git state, since they may have changed. Then carry out the next unfinished step. Ask for clarification only if a genuine blocker remains.
