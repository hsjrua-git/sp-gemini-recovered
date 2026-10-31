# Ready-to-paste handoff — GPT-6 Astra: local Student Panel audit

Continue the interrupted audit using project files and this prompt, consolidated
against saved evidence/read-only checks on 2026-10-29. You have no earlier chat.
**Stage 1 is incomplete; Stage 2 has not started.**

## 1. Goal and acceptance criteria

Complete an evidence-backed **local** audit, then authorized safe fixes with
regressions and real end-to-end verification. Deliver `audit/AUDIT_REPORT.md`,
Stage 2 `audit/FIX_LOG.md`, reproductions in `audit/checks/`, actual output/exit
metadata, and separate **local** commits per finding or tight group.

Fully read every source file and existing test; record coverage gaps and rate
tests USEFUL, WEAK, USELESS, or WRONG. Findings require exact locations, evidence,
severity, VERIFIED/LIKELY/SUSPECTED status, effort, and AUTO/ASK disposition.
Distinguish executed behavior, source-established facts, and suspicions. Run full
checks before/after fixes; disclose unrun checks/decisions. Passing tools alone
are not an all-clear.

Latest request: consolidate handoffs as files, **no implementation during
preparation**. Only handoff documents were added. Resume Stage 1, first recovering
isolated services after harness/server restarts.

## 2. Explicit constraints and agreed decisions

- **Read `AGENTS.md` and applicable nested instructions first.** Local files are
  authoritative. Upstream `https://github.com/hsjrua-git/sp-gemini-1` is reference
  only: **never clone, pull, push, change remotes, deploy, or publish.** This
  overrides `AGENTS.md`'s push recommendation.
- Stage 1 is read-only outside `audit/`. Dependency installation was allowed
  while preserving lockfiles. Read scripts before executing them. Do not touch
  files outside the project or install global packages.
- Mutate only isolated local test databases. Never print `.env` contents or
  disclose credentials/tokens/secrets. Reference keys, not values.
- Preserve pre-existing untracked `partly-schema/` and the supplied
  `audit/HANDOFF.md`. Do not reset, discard, delete, or broadly stage user work.
- Stage 2 requires a new `audit-fixes` branch, `FIX_LOG.md`, severity-ordered AUTO
  fixes, retained reproductions, and separate named-path commits. Skip ASK
  items and continue. Schema/public behavior or API changes, major upgrades,
  large rewrites, feature removal, uncertain deletions, and license changes need
  approval. Existing AUTO classifications cover narrow bug fixes only.
- If stopping early, preserve an honest clean committed checkpoint consistent
  with the stage. **Committing audit artifacts on `main` was not agreed.**
- Repository conventions: ES modules, parameterized SQL, permission-keyed
  routes, React Query server state, shared token-based CSS, bilingual error-code
  translations. Confirm unfamiliar library APIs through Context7; inspect the
  real schema before database-code changes.
- Isolated PostgreSQL: `127.0.0.1:55439`, database `student_panel_audit`, role
  `audit_owner`; API/SPA: `http://127.0.0.1:3300`. Leave unrelated port 3000 and
  normal port-5432 databases untouched. Helpers pin isolation explicitly.
- PostgreSQL MCP was unavailable, then targeted another database:
  `127.0.0.1:5432/sp_gemini_1_audit`. Recheck after reconnects; never mutate it.
  Agreed isolated inspection/mutation fallback: pinned direct connection, not
  project `.env`.
- Run shared-database mutation probes **serially**. Concurrent accounting/kiosk
  probes caused verified harness interference. Void-confirmation protocol
  redesign remains ASK.

## 3. Verified current state and evidence locations

Read-only checks around **2026-10-29 17:15 UTC** established:

- Working directory/only listed worktree:
  `/home/hsjrua/Documents/sp-gemini-1`; branch `main`, tracking `origin/main`.
- HEAD: `a4d81f07d2e016341310dc8df79b9c878cf32ada`, subject
  `fix: complete audit remediation and schema 4 alignment`. This is the
  **pre-existing baseline**, not completion of this audit.
- Status shows only `?? audit/` and `?? partly-schema/`; tracked and staged
  diffs are empty. No application fixes, lockfile changes, audit commits, or
  pushes. No `audit-fixes` branch or `audit/FIX_LOG.md`. Remote freshness unknown.
- Three packages: `server/` Express 5/PostgreSQL/Node tests; `client/` React 19,
  Vite 8, React Router 8, React Query 5, bilingual Persian-default RTL UI and
  Capacitor; `agent/` separate zero-dependency bilingual kiosk. `deploy/` holds
  backup/restore scripts. Server `src/core/` is a PGlite test mirror, not the
  production Express path. Money is bigint whole Toman; quantities numeric(12,3).
- Dependencies were installed with
  `npm ci --ignore-scripts --no-audit --no-fund` in all three packages.
- Initial inventory: 631 files, 470 tracked, approximately 80,051 text lines.
  Recorded full reads: **197 files / 29,229 lines**. All 65 existing automated
  test files were read/rated; Android tests were not executed.
- `partly-schema/` contains `schema-4.sql`, `schema-4-security.sql`, and
  `schema-4.dbml`; all still marked unreviewed. Two completed conversation reads
  are also unrecorded: `client/src/components/StudentBalanceSection.jsx` and
  `client/src/lib/money.js`. Re-read if needed before recording.

Artifacts added during the audit:

- `audit/AUDIT_REPORT.md`: in-progress findings A01–A11 and limitations.
- `audit/TEST_QUALITY.md`: existing-test ratings and assertion weaknesses.
- `audit/inventory.json`, `inventory.mjs`, `record-review.mjs`: initial hashes
  and review tracking. **Do not rerun `inventory.mjs`: it overwrites progress.**
  Record only genuinely completed full reads with
  `node audit/record-review.mjs current <paths...>`; searches do not count.
- `audit/scan.mjs`, `scan.json`: limited credential/import/dead-code candidates;
  seven reachable commits scanned. No candidate deletion was authorized.
- `audit/run-command.mjs`: output plus command/exit metadata. Usage:
  `node audit/run-command.mjs PHASE NAME DIRECTORY EXECUTABLE [ARGS...]`.
  **Repeated phase/name overwrites evidence.** Use new names/phases for reruns.
  `.json` files are runner metadata; dependency audit payloads are in `.txt`.
  Runner stdin is ignored; interactive restore needs a separate controlled
  harness that also captures output/status.
- `audit/checks/isolated.mjs`: pinned DB/API and cookie-aware authentication;
  obtain disposable fixture authentication there without copying credentials.
- `audit/start-server.mjs`: pins isolation, production mode and Origin checks,
  ignores project `.env`, generates an in-memory session secret.
- `audit/baseline/`: saved results, `scoring-schema.*`, `financial-schema.*`,
  `isolated-schema.*`, and `browser-routes.md`. Runtime/cache/temp directories
  are ignored by `audit/.gitignore`; never commit them.
- Supplied `audit/HANDOFF.md` preserved; consolidation added this prompt and
  `audit/HANDOFF_COMPARISON.md` only. Report/inventory/application unchanged.

### Services need recovery, not reinitialization

Latest checks: `pg_isready -h 127.0.0.1 -p 55439`: no response/exit 2;
port-3300 health request: refused/exit 7. Historical passes do not mean services
are running.

The existing PostgreSQL 16 cluster remains at `audit/runtime/pgdata/`. Inspect
process/lock state and `postmaster.opts`; **do not initialize, reset, or reseed**.
From the project root, after verifying safety:

```bash
/usr/lib/postgresql/16/bin/pg_ctl -D audit/runtime/pgdata -o "-h 127.0.0.1 -p 55439 -k $PWD/audit/.tmp/pgsocket" -l audit/runtime/postgres.log start
```

Launch `node audit/start-server.mjs` in the harness background; preserve existing
logs. Check health/DB identity. Avoid ordinary `.env` startup. Reauthenticate;
old browser tab IDs/session state may be invalid.

Previously applied: 35 migrations; seed of 30 students, 6 parameters, 5
assignments, 71 sessions, 13 answered periods, 573 cells. Synthetic archived
fixtures/append-only evidence remain: **counts are no longer current**.
`server/.env` and `agent/.env` were not changed/disclosed.

## 4. Findings and unresolved questions

All A01–A11 are VERIFIED, **A06 by reading only**. Ten scripts failed meaningfully
with exit 1. Script: `audit/checks/<name>.mjs`; evidence:
`audit/baseline/<name>.{txt,json}`. Effort: small except A02/A03/A09 medium.
Fixes below are **proposals, not implemented**.

| ID / severity / disposition | Established evidence and location | Check name |
|---|---|---|
| A01 HIGH AUTO | `deploy/backup.sh:38-41` splits spaced filenames. With KEEP=1, backup exits 0, deletes unrelated sentinel, retains expired dump, leaves two dumps. Preserve filename boundaries. | `backup-spaces` |
| A02 HIGH AUTO | `server/src/routes/roles.js:136` PATCH/guard at `196`: concurrent permission edits both return 200; manager counts go from two to zero. Audit-table barrier after guards; fixture roles restored. Proposed shared invariant lock with `server/src/routes/users.js:116-155`. **Role/user interleaving untested.** | `role-manager-race` |
| A03 HIGH AUTO, narrow scope | `agent/src/dialogue.js:240-280`, `agent/src/tools.js:204-224`: two concurrent screen confirmations produce two adapter sale calls for one cart. Delayed adapter, **no duplicate real writes**. Proposed synchronous single-flight state/immutable snapshot; protocol or cross-process redesign ASK. | `concurrent-confirm` |
| A07 HIGH AUTO | `server/src/routes/students.js:27-33#loadDefinitions` passes active-only definitions to `server/src/lib/fields.js#stripRestricted`. Archived restricted value leaks through real detail/list to viewer lacking `fields.view_restricted`. Fixture soft-deleted. Separate privacy filtering from active-only validation. | `archived-field-privacy` |
| A09 HIGH ASK | `agent/src/dialogue.js:189-190`, `agent/src/tools.js:227#void_last_sale`, `agent/src/intents.js`: stage-2 `undo`, stage-3 `do not undo`, model tool on `hello` each void once without required confirmation. Spy adapter, **no financial writes**. Agree protocol before changing it. | `void-stage-gate` |
| A08 MEDIUM AUTO | `agent/src/kiosk.js:47`: fresh child receiving `Host: [` crashes with ECONNRESET, ERR_INVALID_URL, exit 1 instead of 400. Contain parsing/request failures. | `kiosk-malformed-host` |
| A04 MEDIUM AUTO | `server/src/middleware/csrf.js:42-47#sameToken`, called by `verifyToken`: equal character counts/unequal UTF-8 buffer lengths throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH instead of 403. Compare byte lengths; no bypass demonstrated. | `csrf-unicode` |
| A10 MEDIUM AUTO | `server/src/routes/cafeInventory.js:168-176`: real waste 0.145 × 100 posts 14 rather than exact rounded 15; stock 0.855. Proposed SQL numeric valuation then safe money conversion. | `fractional-waste` |
| A11 MEDIUM AUTO | `server/src/lib/cafeSale.js:99-109`: valid zero-price student sale returns HTTP 500/23514 because zero charge violates ledger constraint. Void `180-191` has analogous zero-refund risk, **not separately executed**. Skip zero balance movement while preserving stock/COGS/audit and unchanged balance; no schema change. | `zero-price-student-sale` |
| A05 LOW AUTO | `server/src/routes/cafeSales.js:140` omits absent balance; `agent/src/panel.js:138#recordSale` converts undefined to NaN. Real adapter/API probe; sale voided. Normalize absent balance in adapter, not a public API redesign. | `walk-in-response` |
| A06 LOW, assertion AUTO/deletion ASK | `client/android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java:15-16` only tests arithmetic. `client/android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java:24` expects com.getcapacitor.app; `client/android/app/build.gradle:7` configures app.studentpanel.mobile. Reading only. | none |

A10 retained journal entry: `a11d95fd-9043-4830-af81-d7ce53e98857`; synthetic
product/supplier deactivated, append-only records retained.

Pending, **not executed findings**:

- Manual refund direction: `server/src/routes/cafeBalances.js:133` passes
  positive refund as delta; validation/UI accept positive amounts. Migration
  `server/src/db/migrations/026_create_accounting_chart.sql:68` maps refund Dr deposits/Cr cash, seemingly
  opposite balance effects. Reproduce synthetic top-up/refund and correlate
  balance history with posted journal lines. Verify current mapping; decide
  severity/AUTO/ASK from evidence, not assumption.
- Three-decimal rejection: floating checks at `server/src/validation/cafeInventory.js:21`
  and `server/src/validation/cafe.js:186,221`; `1.005` is a useful candidate. No saved
  API/parser reproduction exists; check purchase, sale, waste, adjustment.
- Agent provider timeouts and microphone-to-text fallback remain under review.
- Dependency audit: client reports five affected packages (high Vite,
  source-map-js, zod; moderate Vitest/@vitest/mocker); server/agent report zero.
  Version/reachability review pending; do not run automatic major upgrades.
- Migration 029 destroys prior score/history/view data; historical approval
  unknown. README Accountant close/chart privileges disagree with migration
  026's view/enter/post-only grants.
- Fully read prior reports awaiting reconciliation:
  `docs/audit-notes.md`, `docs/audit-remediation-report.md`,
  `docs/audit-2026-10-28-sp-gemini-1-opencode.md`,
  `docs/schema-4-adaptation.md`, `FINDINGS.md`. Their remediation claims are not
  current audit conclusions.

## 5. Checks actually run and their limitations

These are **historical retained results**, not reruns during preparation:

| Command/check | Result | Baseline stem |
|---|---|---|
| Client `npm run lint` / `npm run build` | PASS / PASS | `lint`, `build` |
| Client `npm test` | 25 files / 214 pass | `tests-client` |
| Server `npm test` | 135 pass / six integration skips | `tests-server` |
| Isolated `RUN_INTEGRATION=1 node --test test/permissions.test.js` | six pass | `tests-permissions` |
| Agent `npm test` | 21 pass | `tests-agent` |
| Server `npm run test:core` / `npm run verify-pglite` | 55 pass / 35 migrations plus checks pass | `tests-core`, `verify-pglite` |
| Isolated real migrations | 35 applied | `migrate` |
| Real stock / sale+reports / alerts / invariant races / serial accounting smokes | 6 / 8+5 / 6 / 5 / 9 checks pass | `smoke-cafe-stock`, `smoke-cafe-sales`, `smoke-alerts`, `smoke-invariants`, `smoke-accounting-serial` |

First accounting run (`smoke-accounting`) failed `241000 !== 229000` because a
concurrent 12000 kiosk sale interleaved; serial rerun passed. Do not classify
that as a product bug or run shared mutations concurrently.

Actual browser login/30 protected routes at **454px Persian/RTL** showed no
detected boundary, horizontal overflow, or captured error-level console messages;
`/` redirected to dashboard, unknown route rendered not-found. This proves
limited rendering/navigation, **not successful workflow submissions**.

Assertion gaps: permission allowed-route checks can accept 500; PGlite rejection
helper accepts arbitrary errors; mirrors do not establish Express behavior;
agent model-gate test uses empty cart; core assignment-scoping test passes an
undefined assignment ID. Integration cleanup assumes exclusive database use.

Still required: backup/restore round trip/failure atomicity; real scoring
preview/save/no-op/locks/override/blind-entry; imports/exports and workbook validity;
broader cafe/accounting lifecycle; cross-route manager race; desktop/keyboard/focus
matrix; Android/device; real speech/model providers; sustained load; dependency
reachability; final full checks. No project type-check command/config was found.

## 6. Ordered safe continuation

1. Read instructions/audit/helpers; verify git/files/process state. Recover the
   existing isolated DB/API and confirm identity/health; preserve logs/evidence.
2. Resume refund-direction and three-decimal reproductions serially; retain
   output with unique names. Determine status/severity/disposition before fixing.
3. Read/run actual backup/restore against a separate disposable database in the
   same isolated cluster. Verify integrity, gzip rejection and transaction
   rollback; never restore over the working evidence database.
4. Complete real scoring/import/export/finance workflows; extend A02 to
   role/user interleavings and investigate agent fallback/timeouts.
5. Finish full source/config/docs/user-schema reads, prior-audit reconciliation
   and dependency review; record coverage. Do not duplicate established findings.
6. Keep Stage 1 incomplete while required review/workflows remain; document
   genuine environmental gaps without claiming passes. Once its gate is met,
   create `audit-fixes`, initialize `FIX_LOG.md`, implement AUTO items in severity
   order, skip ASK, and commit only inspected named paths.
7. Re-run meaningful regressions plus full suites/lint/build with isolated
   settings; preserve before/after evidence and actual outcomes. Leave unresolved
   ASK decisions/gaps explicit and the appropriate local committed checkpoint.
   **Never publish.**

Continue the work from this handoff. First read the applicable repository instructions and verify the current filesystem and git state, since they may have changed. Then carry out the next unfinished step. Ask for clarification only if a genuine blocker remains.
