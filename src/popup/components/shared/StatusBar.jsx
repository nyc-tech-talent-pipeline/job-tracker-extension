export default function StatusBar({ status }) {
  if (!status) return <div className="status-bar hidden" />;
  return <div className={`status-bar ${status.type}`}>{status.message}</div>;
}
