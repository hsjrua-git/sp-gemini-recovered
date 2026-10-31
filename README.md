# Student panel

A small web app for tracking students, entering periodic scores against
configurable parameters, and reviewing results and trends. It has one backend
process (Node/Express + PostgreSQL) and a React front end. Access is controlled
by configurable roles built from fine-grained permissions.

- `server/` — Express API, session auth, PostgreSQL access, migrations.
- `client/` — React + Vite single-page app.
- `agent/` — bilingual voice/text cafe kiosk using the same authenticated API.
- `deploy/` — backup/restore scripts, systemd units, and an example reverse-proxy
  config for running it for real.

## Recovered edition

Branch `recovery/glass-preview` builds on `9167d99`, with selected improvements
from recovery snapshot `2`. The recovery record, source-selection inventory,
screenshots, and verification results are in
[docs/recovery-preview-2026-10-31.md](docs/recovery-preview-2026-10-31.md).

Once the packages, PostgreSQL database, migrations, and `server/.env` are ready,
run **`npm start` from the repository root**. It builds the client first and
starts the Express server only if that build succeeds. Dependencies remain
installed separately in `server/` and `client/`; the root package coordinates
commands. First-time installation is described below.

## What you can do

- **Home overview** — a bounded 2D/3D progress chart above today's classes,
  grading queue, student count, permission-aware quick actions, Cafe/accounting
  snapshots, alerts, and a collapsible setup guide. Operational totals follow
  the database's local day independently of chart filters. The 2D legend sits
  beside the chart on desktop; 3D labels sit underneath.
- **Students** — add, edit, archive; give each one custom fields (see below);
  organise them into groups.
- **Parameters** — coded dimensions such as Speed or Rhythm, with optional
  integer min/max bounds shared by quality and quantity.
- **Assignment periods** — only active sessions with an answered evaluation
  occupy a period. The first answer attaches the session, four sessions fill
  each assignment-local period, and empty selected cells do not consume a slot.
  There is no school-wide period anchor.
- **Evaluate** — select expected cells and enter quality, quantity, and a short
  comment per dimension for one session. Cells lock from the session date
  (seven days for current/future sessions, one day for past sessions); override
  requires a written audited reason. Hierarchical column selection preserves
  hidden drafts; error navigation reveals and focuses invalid input. Class
  links from Home select the corresponding assignment and session.
- **Results & Dashboard** — assignment-period results, trends, and a persisted
  2D/3D cohort constellation, filterable by group and exportable.
- **Groups** — nest students into groups and subgroups to any depth. Filtering
  by a group includes everyone in its subgroups too.
- **Custom fields** — admins define extra fields on students (text, long text,
  number, date, yes/no, choice). A field can be marked *restricted*, in which
  case its values are only shown to people allowed to see restricted fields.
- **Roles & permissions** — build your own roles from a fixed catalogue of
  permission keys. Five roles ship by default: Viewer, Staff, Accountant,
  Kiosk, and Administrator.
- **Bilingual, Persian-first** — the whole interface is Persian/English
  (Persian default) with RTL layout and both Jalali and Gregorian calendars
  side by side; dates are entered in either calendar and stored as ISO.
- **Personal appearance** — locally bundled Vazirmatn, Estedad, Shabnam, and
  Sahel fonts; Aurum and transparent Aurum Glass palettes; light/dark themes;
  and a system or decorative pointer. Choices persist per account.
- **Management pages** — compact, collapsible add forms keep unfinished input
  when closed, with clearer row actions and a labelled icon rail.
- **Teaching** — teachers, recurring assignments (every N days/months),
  generated sessions with move/cancel/archive, session tasks and reusable
  task templates, and incomplete-session alerts surfaced on the dashboard.
- **Cafe** — products and suppliers, purchases feeding an append-only stock
  ledger with a moving-average cost, a point-of-sale for walk-in and
  student sales, prepaid student balances (overdraft allowed by design,
  full transaction history), waste/adjustments, and sales/stock reports.
- **Accounting** — a simplified accrual chart of accounts, a double-entry
  journal whose balance rule is enforced by the database, fiscal periods
  with an automatic closing entry, trial balance / ledger / income
  statement / balance sheet, and automatic posting of cafe events through
  an editable mapping table.
- **Voice agent** — `agent/` implements a Persian/English text or voice cafe
  kiosk with deterministic no-model operation, staged confirmation, optional
  local models, and optional remote-compatible providers. See
  [agent/README.md](agent/README.md) and the architecture record.

## Roles and permissions

Roles are rows in the database; each role holds a set of permission *keys* (the
keys themselves are defined in code, in `server/src/lib/permissions.js`). A user
points at one role. The client shows or hides actions with `can('some.key')`,
and the server enforces the same keys on every route — the UI is a convenience,
the API is the gate.

The seeded roles:

- **Viewer** — read students, scores, parameters, and dashboard.
- **Staff** — everything a Viewer can do, plus add/rename students, enter
  scores, assign students to groups, and export data.
- **Administrator** — everything, including managing users, roles, groups,
  custom fields, parameters, scheduling, cafe/accounting, and the audit log.
- **Accountant** — journal entry, posting, fiscal close, reports, and chart setup.
- **Kiosk** — cafe menu, minimal student lookup, sales, and voids; no full
  student-record access.

Some permissions imply others (their prerequisites are ticked automatically).
The system will not let you remove the last user who can manage users and roles,
so you can never lock yourself out.

## Requirements

- Node.js 20.19+ or 22.12+ (Vite 8's supported runtime; uses `--env-file`).
- PostgreSQL 15 or newer (`NULLS NOT DISTINCT` indexes are part of the schema).

## Quick start (automated installer)

If you just want it running, use the installer instead of the manual steps
below. It checks for Node.js and PostgreSQL, installs them if missing, creates
the database and configuration, installs dependencies, runs the migrations,
creates your first administrator, builds the front end, starts the server, and
opens your browser. It is interactive and safe to re-run — it only does the
steps that are still outstanding.

**Windows** — double-click `setup.bat` (or run `powershell -ExecutionPolicy
Bypass -File setup.ps1`). It requests Administrator rights and uses `winget` to
install Node.js and PostgreSQL if they are missing.

**Linux / macOS** — from the project root:

```bash
bash setup.sh
```

It uses your package manager (`apt`/`dnf`/`pacman`/`zypper`, or Homebrew on
macOS) with `sudo` to install Node.js and PostgreSQL if they are missing, then
takes you through the rest.

What it will and won't do automatically:

- **Installs prerequisites** (a supported Node.js and PostgreSQL 15+) through the OS package
  manager when they are absent. If no supported package manager is found, it
  stops and tells you what to install, then you re-run it.
- **Generates secrets** — the `SESSION_SECRET` and the application database
  password are generated and written to `server/.env` (never printed, never
  committed).
- **Creates the database** by connecting as a PostgreSQL superuser (the local
  `postgres` account via `sudo` on Linux, otherwise prompting for the
  `postgres` role's password). It only creates the role/database if they are
  missing.
- **Prints a one-time temporary password** for the administrator it creates;
  you change it at first login.

You can also run the orchestrator directly if Node and PostgreSQL are already
installed: `node scripts/setup.mjs`.

## First-time setup


```bash
# 1. Install dependencies.
cd server && npm install
cd ../client && npm install

# 2. Create the database (adjust name/user to taste).
createdb student_panel

# 3. Configure the server. Copy the template and fill it in:
#      cp server/.env.example server/.env
#    At a minimum set DATABASE_URL and SESSION_SECRET. Every key is documented
#    in .env.example (PORT, HOST, NODE_ENV, SESSION_COOKIE_SECURE).
#    A quick way to make a secret:
#      node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 4. Create the database tables.
cd ../server && npm run migrate

# 5. Create your first administrator (prints a one-time temporary password).
npm run create-user -- admin "Site Administrator"
#   Optionally pass a role name as the third argument, e.g. ... "Jo" Staff

# 6. Optional development fixture: connected sample data for every module.
#    Refused in NODE_ENV=production unless ALLOW_SAMPLE_DATA=1 is explicit.
npm run seed-sample
# Sample role logins share the printed development-only password.
# Remove the complete fixture world (including ledger rows and users) with:
npm run seed-sample -- remove
```

## Development

Run the API and the Vite dev server in two terminals. Vite proxies `/api` to
the backend, so you use the Vite URL in your browser.

```bash
# Terminal 1 — API with auto-reload.
cd server && npm run dev

# Terminal 2 — front end with hot reload.
cd client && npm run dev
```

## Running it for real (single process)

In production the backend serves the built front end, so there is only one
thing to run. From the repository root:

```bash
npm start
```

This rebuilds the client and starts the server using `server/.env`. PostgreSQL
must already be running and migrations applied. The launcher does not provision
accounts or a database. For deployment systems that build separately, use:

```bash
npm run build
npm --prefix server start
```

If `client/dist/index.html` exists, the server serves it and sends unknown
non-API paths to the app for client-side routing.

Open `http://<this-machine>:3000`, or the configured `PORT`.

### Updating an existing installation

Back up the database, stop the running server, and update the code/dependencies.
Run `npm run migrate` from `server/`, rebuild with `npm run build` from `client/`,
then restart the server. Migrations use the same `DATABASE_URL` as normal startup.
Migration 036 preserves existing quality values and requires them to be within
0–100; it does not convert legacy score scales automatically.

`GET /api/health` checks both database connectivity and required migrations.
A missing migration returns HTTP 503 with `DATABASE_MIGRATIONS_PENDING`, and the
API shows a translated upgrade message before attempting session or feature SQL.
Run the migration command with the maintenance database credentials, then retry.
Readiness refreshes within five seconds (immediately on a health check).
`DATABASE_UNAVAILABLE` instead means the database connection needs attention.

### Android companion

The Capacitor Android build uses the same server and database, so every module
and permission stays in sync with the web app. See [`MOBILE.md`](MOBILE.md) for
HTTPS/API-origin setup and the `cap:*` commands.

### Autostart on boot

Use the provided systemd unit so the app starts on boot and restarts if it
crashes. The file has install steps in its header; in short:

```bash
# Assuming the project lives at /opt/student-panel:
sudo cp deploy/student-panel.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now student-panel
systemctl status student-panel
journalctl -u student-panel -f      # follow the logs
```

Edit `User`, `WorkingDirectory`, and the node path in the unit to match your
machine.

### Access from other computers (LAN)

By default the server binds to all interfaces, so other machines on the same
network can reach it at `http://<this-machine-ip>:3000`. To find the IP, run
`hostname -I` (Linux) or check your network settings. If you have a firewall,
allow the port, e.g. `sudo ufw allow 3000/tcp`. To restrict the app to this
machine only, set `HOST=127.0.0.1` in `server/.env`.

Sessions use a cookie whose `Secure` flag follows `SESSION_COOKIE_SECURE`
(default `auto`), so plain HTTP works on a trusted LAN.

### Serving over HTTPS (recommended off a trusted LAN)

Over plain HTTP the login and session cookie travel unencrypted, so anyone on
the network path can read them. That is only acceptable on an isolated, trusted
LAN. Anywhere else, terminate HTTPS in front of the app with a reverse proxy —
the app is built to run behind one (`app.set('trust proxy', 1)`).

The simplest option is Caddy, which obtains and renews certificates for you.
`deploy/Caddyfile.example` is a ready-to-edit starting point (including a
LAN-only variant that uses Caddy's internal CA). With any HTTPS proxy in place,
set these in `server/.env`:

- `HOST=127.0.0.1` so only the proxy can reach Node,
- `TRUST_PROXY=1` so the app trusts the proxy's `X-Forwarded-*` headers (it
  defaults to off, because trusting them without a proxy lets clients spoof
  their IP and protocol), and
- `SESSION_COOKIE_SECURE=true` so the cookie is always marked Secure.

Any standard proxy works — for nginx, set `proxy_set_header X-Forwarded-Proto
$scheme;` and proxy to `127.0.0.1:3000`.

## Backups

`deploy/backup.sh` writes a compressed `pg_dump` to `backups/` and keeps the 30
most recent. It reads `DATABASE_URL` from `server/.env`.

```bash
./deploy/backup.sh                 # make a backup now
KEEP=60 ./deploy/backup.sh         # keep more history
```

For a nightly backup on a systemd machine, install the timer (steps are in the
files' headers):

```bash
sudo cp deploy/student-panel-backup.service /etc/systemd/system/
sudo cp deploy/student-panel-backup.timer   /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now student-panel-backup.timer
```

Restore a dump (this overwrites the current database, so it asks first):

```bash
./deploy/restore.sh backups/student-panel-YYYYMMDD-HHMMSS.sql.gz
```

## Resetting the data

To return the database to a fresh "institution just started" state — the seeded
roles and your Administrator account only — run from `server/`:

```bash
npm run reset-data              # dry run: shows current rows and what would be wiped
npm run reset-data -- confirm   # actually wipes
```

It clears students, scores, parameters, groups, custom field definitions,
the schedule, cafe/accounting runtime data, voice transcripts, the audit log,
saved views, preferences, and all sessions, and removes every non-admin account.
Roles/permissions, stored secrets, real Administrator accounts, the four
default intervals, and the system chart/mappings are kept or re-seeded; the
schema itself is left in place. It
refuses to run if no active Administrator would remain. This is irreversible, so
take a backup first (see above); everyone is signed out when it finishes.

## Security

A few defences worth knowing about when running this beyond a trusted LAN:

- **Sessions** are server-side (PostgreSQL-backed), the cookie is `httpOnly`,
  `SameSite=lax`, and its `Secure` flag is configurable (see
  `SESSION_COOKIE_SECURE` above). Passwords are hashed with argon2, login is
  rate-limited, and the session id is regenerated on login.
- **CSRF**: state-changing API calls are protected two ways — an Origin/Referer
  check (in the single-process production build) and a double-submit token (the
  server sets a readable `csrf` cookie; the client echoes it in an
  `X-CSRF-Token` header). See `server/src/middleware/csrf.js`.
- **CSP**: a Content-Security-Policy is sent with the app (scripts limited to
  `'self'`), which is why the client bundles everything and loads nothing from a
  CDN. See the Helmet config in `server/src/index.js`.
- **Transport**: serve over HTTPS off a trusted LAN (see the reverse-proxy
  section above); the app is designed to run behind one proxy hop.
- **Database roles**: `deploy/postgres-roles.example.sql` is an operator-run
  least-privilege template for separate migration-owner, app, and read-only
  roles; the reporting role cannot read users, sessions, or secrets.

## Tests

From the repository root:

```bash
npm run lint
npm test          # server unit + core, client, and agent suites
npm run build
```

Package-level commands and additional database checks:

```bash
cd server && npm test                 # server unit tests (node:test)
cd server && npm run test:core        # PGlite-backed services
cd server && npm run verify-pglite    # all migrations + DB checks
cd server && npm run smoke:invariants # real PostgreSQL concurrency probes
cd server && node --env-file=.env src/scripts/alertsSmoke.mjs
cd server && node --env-file=.env src/scripts/accountingSmoke.mjs
cd server && node --env-file=.env src/scripts/cafeStockSmoke.mjs
cd server && node --env-file=.env src/scripts/cafeSalesSmoke.mjs
cd client && npm test                 # client unit + component tests (Vitest)
cd client && npm run lint && npm run build
cd agent && npm test
```

Server unit tests live in `server/test/` and cover the pure logic (permissions,
locks, results, imports, score preview) plus the auth and CSRF middleware.
Client tests live next to the code (`client/src/**/*.test.{js,jsx}`) and cover
the scoring/results/dashboard/import helpers and key components.

The permission test is a separate integration test: it needs a running server
and three role users. On a development database, `npm run seed-sample` creates
the default `sample-admin`, `sample-staff`, and `sample-viewer` fixtures. Point it at a
throwaway database — the "admin can reach everything" pass issues real writes,
and it exercises the auth, permission, and CSRF layers end to end.

```bash
# With the server running against a test database:
TEST_SERVER_URL=http://localhost:3000 \
npm run test-permissions
```
