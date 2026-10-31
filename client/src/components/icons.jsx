// Small inline SVG glyphs used in the score grids and elsewhere, replacing the
// emoji (🔒 📝 🗒) that rendered inconsistently across platforms and ignored the
// theme. Each inherits `currentColor` and sizes to ~1em, so surrounding CSS
// (e.g. `.lock`, `.note-toggle`) controls colour and scale. Decorative by
// default (aria-hidden); the interactive controls that host them carry their own
// aria-label.
function Svg({ children, size = 15, title, ...rest }) {
  return (
    <svg
      {...rest}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

// A closed padlock: the locked-cell marker.
export function LockIcon(props) {
  return (
    <Svg {...props}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </Svg>
  );
}

// An empty note: a plain lined card, for "add a note".
export function NoteIcon(props) {
  return (
    <Svg {...props}>
      <rect x="4.5" y="4" width="15" height="16" rx="2" />
      <path d="M8 9h8M8 12.5h8M8 16h5" />
    </Svg>
  );
}

// A note with content: the card plus a small pencil, for "edit note".
export function NoteFilledIcon(props) {
  return (
    <Svg {...props}>
      <path d="M13 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V11" />
      <path d="M8 9h4M8 12.5h3.5" />
      <path d="M18.4 3.6a1.6 1.6 0 0 1 2.3 2.3l-5.1 5.1-2.7.6.6-2.7 4.9-5.3Z" />
    </Svg>
  );
}

// An up-arrow into a tray: the marker for the import file drop-zones.
export function UploadIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 15V4" />
      <path d="m8 8 4-4 4 4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

// A down-arrow out of a tray: the marker for downloads / the Export Center.
export function DownloadIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 4v11" />
      <path d="m8 11 4 4 4-4" />
      <path d="M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
    </Svg>
  );
}

// A plain X: dismiss a dialog or drawer.
export function CloseIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/* ---- sidebar navigation glyphs ----
   One per menu item, sharing the same Svg wrapper (currentColor, ~1em) so they
   inherit the nav link's colour and sit on the icon-only collapsed rail. */

// Four tiles: the dashboard/overview.
export function DashboardIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </Svg>
  );
}

// A small bar chart: results.
export function ResultsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 4v16h16" />
      <path d="M8 16v-4" />
      <path d="M12 16V8.5" />
      <path d="M16 16v-6.5" />
    </Svg>
  );
}

// Two figures: students.
export function StudentsIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8" r="3.3" />
      <path d="M3.6 19.5a5.5 5.5 0 0 1 10.8 0" />
      <path d="M15.6 5.3a3.2 3.2 0 0 1 0 6" />
      <path d="M17.2 19.5a5.5 5.5 0 0 0-2.3-4.4" />
    </Svg>
  );
}

// A clipboard with a check: enter/evaluate scores.
export function EvaluateIcon(props) {
  return (
    <Svg {...props}>
      <path d="M5 5.5h14v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z" />
      <path d="M9 4.5h6v3H9z" />
      <path d="m8.5 13 2 2 3.5-4" />
    </Svg>
  );
}

// Two sliders: parameters/settings-of-measure.
export function ParametersIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 8h7M15 8h5" />
      <circle cx="13" cy="8" r="2" />
      <path d="M4 16h5M13 16h7" />
      <circle cx="11" cy="16" r="2" />
    </Svg>
  );
}

// A small node tree: groups.
export function GroupsIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="5" r="2.4" />
      <circle cx="5" cy="18.5" r="2.4" />
      <circle cx="19" cy="18.5" r="2.4" />
      <path d="M12 7.4v3.1M12 10.5H5v5.6M12 10.5h7v5.6" />
    </Svg>
  );
}

// Brackets around a line: custom fields.
export function FieldsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M8 4.5H6.5a2 2 0 0 0-2 2V9M4.5 15v2.5a2 2 0 0 0 2 2H8" />
      <path d="M16 4.5h1.5a2 2 0 0 1 2 2V9M19.5 15v2.5a2 2 0 0 1-2 2H16" />
      <path d="M8.5 12h7" />
    </Svg>
  );
}

// A cog: settings.
export function SettingsIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.6v2.8M12 18.6v2.8M21.4 12h-2.8M5.4 12H2.6M18.6 5.4l-2 2M7.4 16.6l-2 2M18.6 18.6l-2-2M7.4 7.4l-2-2" />
    </Svg>
  );
}

// A single figure: user management.
export function UsersIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
    </Svg>
  );
}

// A figure at a board: teachers.
export function TeacherIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="4" width="17" height="9.5" rx="1.5" />
      <path d="M12 13.5v1.8" />
      <circle cx="12" cy="17.6" r="2.2" />
      <path d="M8.8 21.5a3.4 3.4 0 0 1 6.4 0" />
    </Svg>
  );
}

// A calendar sheet: the schedule of recurring assignments.
export function CalendarIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4" />
    </Svg>
  );
}

// A calendar sheet with entries: the generated sessions.
export function SessionIcon(props) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="1.5" />
      <path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 13h9M7.5 16.5h5.5" />
    </Svg>
  );
}

// A steaming cup: the cafe section.
export function CoffeeIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4.5 8.5h11v5a4.5 4.5 0 0 1-4.5 4.5H9a4.5 4.5 0 0 1-4.5-4.5z" />
      <path d="M15.5 9.5h1.25a2.5 2.5 0 0 1 0 5h-1.4" />
      <path d="M8.5 3v2.4M12 3v2.4" />
    </Svg>
  );
}

// A shopping cart: the cafe POS.
export function CartIcon(props) {
  return (
    <Svg {...props}>
      <path d="M3 4.5h2l2.2 10.2a1.6 1.6 0 0 0 1.6 1.3h6.9a1.6 1.6 0 0 0 1.6-1.2L19 8H6" />
      <circle cx="9.5" cy="20" r="1.4" />
      <circle cx="16.5" cy="20" r="1.4" />
    </Svg>
  );
}

// A delivery truck: cafe purchasing.
export function TruckIcon(props) {
  return (
    <Svg {...props}>
      <path d="M2.5 5.5h11v10h-11z" />
      <path d="M13.5 9h3.3l2.7 3v3.5h-6z" />
      <circle cx="6.5" cy="18" r="1.6" />
      <circle cx="16.5" cy="18" r="1.6" />
    </Svg>
  );
}

// Stacked boxes: the stockroom.
export function BoxIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 20 7v10l-8 3.8L4 17V7z" />
      <path d="M4 7l8 3.8L20 7M12 10.8V20.8" />
    </Svg>
  );
}

// Rising bars: cafe reports.
export function BarsIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Svg>
  );
}

// An open ledger book: the accounting journal.
export function LedgerIcon(props) {
  return (
    <Svg {...props}>
      <path d="M4 4.5h7a2 2 0 0 1 2 2V20a2 2 0 0 0-2-1.5H4z" />
      <path d="M20 4.5h-7a2 2 0 0 0-2 2V20a2 2 0 0 1 2-1.5h7z" />
      <path d="M7 9h2M15 9h2M7 13h2M15 13h2" />
    </Svg>
  );
}

// A friendly robot head: the AI panel.
export function BotIcon(props) {
  return (
    <Svg {...props}>
      <rect x="5" y="8" width="14" height="11" rx="3" />
      <path d="M12 8V4.5M9 4.5h6" />
      <circle cx="9.5" cy="13" r="1.2" />
      <circle cx="14.5" cy="13" r="1.2" />
      <path d="M9.5 16.2h5" />
    </Svg>
  );
}

// A speech transcript: the retained dialogue log.
export function TranscriptIcon(props) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h9.5L19 7v13.5H6z" />
      <path d="M9 8.5h7M9 12h7M9 15.5h4.5" />
      <path d="m4.5 19 2-2.5" />
    </Svg>
  );
}

// Scales: reports and the fiscal year.
export function ScaleIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3v17M5 20h14" />
      <path d="M12 6 5 8m7-2 7 2" />
      <path d="M3.5 13 5 8l1.5 5a1.8 1.8 0 0 1-3 0zM14.5 13 16 8l1.5 5a1.8 1.8 0 0 1-3 0z" />
    </Svg>
  );
}

// A shield with a check: roles/permissions.
export function RolesIcon(props) {
  return (
    <Svg {...props}>
      <path d="M12 3.2 19 5.6v5.4c0 4.4-3 7.7-7 9-4-1.3-7-4.6-7-9V5.6z" />
      <path d="m9 12 2 2 4-4" />
    </Svg>
  );
}

// A clock with a hand: the audit history log.
export function AuditIcon(props) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.4V12l3 1.9" />
    </Svg>
  );
}

// Double chevron: the sidebar collapse-to-rail toggle. Rotated 180° by CSS
// when the rail is already collapsed, so one glyph serves both directions.
export function ChevronsLeftIcon(props) {
  return (
    <Svg {...props}>
      <path d="m13 6-6 6 6 6" />
      <path d="m19 6-6 6 6 6" />
    </Svg>
  );
}

/* ---- pinned account actions (sidebar bottom) ---- */

// Two upright sliders: personal preferences (distinct from the horizontal
// ParametersIcon so the account action doesn't read as the Parameters page).
export function PreferencesIcon(props) {
  return (
    <Svg {...props}>
      <path d="M7 4v7M7 15v5" />
      <circle cx="7" cy="13" r="2" />
      <path d="M17 4v3M17 11v9" />
      <circle cx="17" cy="9" r="2" />
    </Svg>
  );
}

// A door with an arrow leaving it: sign out.
export function SignOutIcon(props) {
  return (
    <Svg {...props}>
      <path d="M9 20.5H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h3" />
      <path d="M15.5 16.5 20 12l-4.5-4.5" />
      <path d="M20 12H9" />
    </Svg>
  );
}
// Distinct navigation marks for templates, account hierarchy and fiscal dates.
export function TaskTemplatesIcon(props) {
  return <Svg {...props}><rect x="4" y="4" width="13" height="14" rx="2" /><path d="M8 20h10a2 2 0 0 0 2-2V8M7.5 9l1.5 1.5 3-3M7.5 14h6.5" /></Svg>;
}

export function AccountsTreeIcon(props) {
  return <Svg {...props}><rect x="3.5" y="3.5" width="6" height="4.5" rx="1" /><path d="M6.5 8v10.5M6.5 12h4.5M6.5 18.5h4.5" /><rect x="11" y="9.8" width="9.5" height="4.4" rx="1" /><rect x="11" y="16.3" width="9.5" height="4.4" rx="1" /></Svg>;
}

export function FiscalPeriodIcon(props) {
  return <Svg {...props}><path d="M11 19.5H5a1.5 1.5 0 0 1-1.5-1.5V6.5A1.5 1.5 0 0 1 5 5h13a1.5 1.5 0 0 1 1.5 1.5V11M3.5 9h16M8 3v3.5M15 3v3.5" /><circle cx="16.8" cy="16.8" r="4.2" /><path d="M16.8 14.8v2.1l1.4 1" /></Svg>;
}
