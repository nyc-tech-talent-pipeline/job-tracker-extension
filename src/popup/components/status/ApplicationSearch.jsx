import { useState } from 'react';
import { getConfig } from '../../lib/config.js';
import { fetchSheetRows, getHeaderOffset } from '../../lib/sheets.js';

export default function ApplicationSearch({ selectedRow, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null); // null = hidden, [] = no matches / error
  const [error, setError] = useState(null);

  async function handleSearch(value) {
    setQuery(value);
    const q = value.trim().toLowerCase();
    if (!q) { setResults(null); return; }

    const cfg = await getConfig();
    if (!cfg.sheetId) {
      setResults(null);
      return;
    }

    try {
      const rows = await fetchSheetRows(cfg);
      const headerOffset = await getHeaderOffset(cfg);

      // fetchSheetRows already strips the header row if present
      const allMatches = rows
        .map((row, i) => ({
          rowIndex: i + 1 + headerOffset,
          date: (row[0] || '').trim(),
          company: (row[2] || '').trim(),
          title: (row[3] || '').trim(),
          url: (row[4] || '').trim()
        }))
        .filter(r => `${r.company} ${r.title}`.toLowerCase().includes(q));

      // Deduplicate by company+title — keep the most recent (first row = newest since sheet is newest-first)
      const seen = new Set();
      const matches = allMatches.filter(r => {
        const key = `${r.company}|${r.title}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      setError(null);
      setResults(matches.slice(0, 8));
    } catch {
      setError('❌ Could not read sheet — check your Sheet ID in Settings');
      setResults([]);
    }
  }

  function handleSelect(app) {
    setQuery('');
    setResults(null);
    onSelect(app);
  }

  return (
    <div className="section">
      <div className="section-title">Which application?</div>
      <input className="field-edit" placeholder="Search company name…" value={query} onChange={e => handleSearch(e.target.value)} />
      {results !== null && (
        <div className="result-list">
          {error ? (
            <div style={{ padding: 10, fontSize: 12, color: '#c5221f' }}>{error}</div>
          ) : results.length === 0 ? (
            <div style={{ padding: 10, fontSize: 12, color: '#888', textAlign: 'center' }}>No matches found</div>
          ) : (
            results.map(r => (
              <div key={r.rowIndex} className="result-item" onClick={() => handleSelect(r)}>
                <div className="r-company">{r.company}</div>
                <div className="r-title">{r.title || '—'}</div>
                <div className="r-date">{r.date}</div>
              </div>
            ))
          )}
        </div>
      )}
      {selectedRow && (
        <div className="selected-app">
          <div className="sa-company">{selectedRow.company}</div>
          <div className="sa-title">{selectedRow.title}</div>
        </div>
      )}
    </div>
  );
}
