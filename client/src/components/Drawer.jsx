import { useEffect, useEffectEvent, useRef } from 'react';
import { createPortal } from 'react-dom';

// The shared slide-over shell for the dashboard's detail drawers: a scrim plus a
// right-hand panel portalled to <body>, with focus trapped inside while open,
// Escape and the scrim to close, the page scroll locked behind it, and focus
// returned to whatever opened it on close. Extracted from ParameterDrawer so the
// parameter, student and cohort drawers share one identical, verified shell; each
// caller supplies only its own body (and the render-time caching that keeps the
// panel from flashing empty as it slides out).
//
// Portal to <body> rather than rendering in place: the drawer is a fixed-position
// overlay, not part of the page flow. Kept inside #main-content it became a direct
// child of the page root, which AnimatedRoutes (App.jsx) treats as a section and
// slides on every navigation — so the empty panel animated into view whenever the
// dashboard mounted. Outside it the route choreography never touches the drawer,
// and `position: fixed` is guaranteed viewport-relative (no transformed ancestor
// can capture it).
function Drawer({ open, titleId, onClose, children }) {
  const panelRef = useRef(null);
  const prevFocus = useRef(null);
  const closeFromKeyboard = useEffectEvent(() => onClose());

  // Trap focus inside the panel while open; Escape closes it. On close (effect
  // cleanup) focus returns to whatever opened the drawer.
  useEffect(() => {
    if (!open) return undefined;
    prevFocus.current = document.activeElement;
    const panel = panelRef.current;
    if (!panel) return undefined;

    const focusable = () =>
      [...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      )].filter(element => !element.closest('[inert]') && element.getClientRects().length > 0);
    (focusable()[0] ?? panel).focus();

    function handleKey(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFromKeyboard();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === panel)
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || document.activeElement === panel)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      prevFocus.current?.focus?.();
    };
  }, [open]);

  // Lock the page behind the modal so a scroll gesture moves the drawer's own
  // overflow, not the dashboard underneath it.
  useEffect(() => {
    if (!open) return undefined;
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previous;
    };
  }, [open]);

  return createPortal(
    <>
      <div
        className={`drawer-scrim${open ? ' open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={`param-drawer${open ? ' open' : ''}`}
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-hidden={!open}
        inert={!open}
      >
        {children}
      </aside>
    </>,
    document.body
  );
}

export default Drawer;
