// Native disclosure keeps unfinished form state mounted when collapsed, and
// provides keyboard/expanded-state semantics without a second focus trap.
export default function CreateSection({ title, children }) {
  return (
    <details className="section-card create-section">
      <summary>
        <span className="create-section-mark" aria-hidden="true">+</span>
        <h2>{title}</h2>
      </summary>
      <div className="create-section-body">{children}</div>
    </details>
  );
}
