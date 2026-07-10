export default function ChipGrid({ items, selected, onToggle }) {
  return (
    <div className="chip-grid">
      {items.map(item => (
        <div
          key={item}
          className={`chip${selected.has(item) ? ' selected' : ''}`}
          onClick={() => onToggle(item)}
        >
          {item}
        </div>
      ))}
    </div>
  );
}
