import { useEffect, useState } from 'react';

// "Don't forget to log this application!" toast, rendered into the content
// script's closed shadow root. Auto-dismisses after 8s; the parent unmounts
// the React root and removes the shadow host once the slide-out finishes.
export default function Toast({ label, onDismiss }) {
  const [hiding, setHiding] = useState(false);

  function dismiss() {
    setHiding(true);
    setTimeout(onDismiss, 260);
  }

  useEffect(() => {
    const timer = setTimeout(dismiss, 8000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={`toast${hiding ? ' hiding' : ''}`} role="alert">
      <span className="icon">💼</span>
      <div className="body">
        <div className="title">Don't forget to log this application!</div>
        <div className="sub" title={label}>{label}</div>
      </div>
      <button className="close" aria-label="Dismiss" onClick={dismiss}>×</button>
      <div className="progress" />
    </div>
  );
}
