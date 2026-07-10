import { getToken } from './auth.js';

// Safe wrapper: handles HTML error pages and auto-retries once on 401 with fresh token
async function sheetsFetch(url, options = {}, retried = false) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), Authorization: `Bearer ${token}` }
  });

  if (res.status === 401 && !retried) {
    await chrome.storage.local.get('googleAuth').then(s => {
      if (s.googleAuth) chrome.storage.local.set({ googleAuth: { ...s.googleAuth, issuedAt: 0 } });
    });
    return sheetsFetch(url, options, true);
  }

  if (!res.ok) {
    const text = await res.text();
    let message = `Sheets API error (${res.status})`;
    try { message = JSON.parse(text).error?.message || message; } catch { /* HTML page */ }
    if (res.status === 401) message = 'Session expired — please reconnect Google in Settings';
    if (res.status === 404) message = 'Sheet not found — check your Sheet ID in Settings (paste the ID or full URL)';
    if (res.status === 403) message = "No access to this sheet — make sure it's your sheet";
    throw new Error(message);
  }
  return res;
}

export async function getHeaderOffset(cfg) {
  // Returns 1 if sheet has a header row, 0 if data starts at row 1
  const token = await getToken();
  const tabName = encodeURIComponent('Applications!A1');
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${tabName}`;
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  const firstCell = (data.values?.[0]?.[0] || '').toLowerCase().trim();
  return /^(date|company|title|application|date applied|company name|role name)$/i.test(firstCell) ? 1 : 0;
}

export async function fetchSheetRows(cfg) {
  const token = await getToken();
  const tabName = encodeURIComponent('Applications!A:J');
  const endpoint = `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${tabName}`;
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Could not fetch sheet');
  const data = await res.json();
  let rows = data.values || [];
  if (rows.length === 0) return [];

  const firstCell = (rows[0][0] || '').toLowerCase().trim();
  const looksLikeHeader = /^(date|company|time|title|application|date applied|company name|role name)$/i.test(firstCell);
  if (looksLikeHeader) rows = rows.slice(1);

  return rows;
}

// Check if a URL already exists in column D of the sheet
export async function findExistingRow(cfg, url) {
  try {
    const rows = await fetchSheetRows(cfg);
    const normalise = u => u.trim().replace(/\/$/, '').toLowerCase();
    const match = rows.find(row => normalise(row[3] || '') === normalise(url));
    if (!match) return null;
    return { date: match[0] || '', company: match[1] || '' };
  } catch {
    return null; // if check fails, allow logging rather than block
  }
}

export async function appendToSheet(cfg, row) {
  const tab = 'Applications';

  const metaRes = await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`
  );
  const metaData = await metaRes.json();
  const sheet = metaData.sheets?.find(s => s.properties.title === tab);
  if (!sheet) throw new Error(`No "${tab}" tab found in your sheet`);
  const sheetId = sheet.properties.sheetId ?? 0;

  // Insert a blank row at position 2 (after header)
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{
          insertDimension: {
            range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
            inheritFromBefore: false
          }
        }]
      })
    }
  );

  const range = encodeURIComponent(`${tab}!A2`);
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}

// Update the Status column in the Applications sheet for a given URL
export async function updateApplicationStatus(cfg, token, url, status, selectedRow = null) {
  try {
    const tab = 'Applications';
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${tab}!A:J`)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const rows = data.values || [];
    if (!rows.length) return;

    const normalise = u => (u || '').trim().replace(/\/$/, '').toLowerCase();
    const targetUrl = normalise(url);

    const header = rows[0] || [];

    // The first column is NOT an auto-number — it's a date.
    // Just find URL and Status directly from header names
    const urlIdx = header.findIndex(h => /\burl\b/i.test(h));
    const statusIdx = header.findIndex(h => /\bstatus\b/i.test(h));

    const uIdx = urlIdx >= 0 ? urlIdx : 4; // fallback column E
    const sIdx = statusIdx >= 0 ? statusIdx : 8; // fallback column I

    let finalIndex = rows.findIndex((r, i) => i > 0 && normalise(r[uIdx]) === targetUrl);

    if (finalIndex === -1 && selectedRow) {
      const compIdx = header.findIndex(h => /company/i.test(h));
      const roleIdx = header.findIndex(h => /role|title/i.test(h));
      if (compIdx >= 0 && roleIdx >= 0) {
        finalIndex = rows.findIndex((r, i) => i > 0 &&
          (r[compIdx] || '').toLowerCase().trim() === (selectedRow.company || '').toLowerCase().trim() &&
          (r[roleIdx] || '').toLowerCase().trim() === (selectedRow.title || '').toLowerCase().trim()
        );
      }
    }
    if (finalIndex === -1) return;

    const sheetRow = finalIndex + 1;
    const colLetter = String.fromCharCode(65 + sIdx);

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${tab}!${colLetter}${sheetRow}`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [[status]] })
      }
    );
  } catch {
    // fail silently, matching original behavior
  }
}

// Turns the raw interview-form selections into the derived fields used by
// saveInterviewDetails() and scheduleInterviewReminders() — was previously
// scraped straight out of the DOM by collectInterviewData().
export function formatInterviewData({ date, time, types, dsSelected, algoSelected, sysSelected, role }) {
  const timeValue = time || '09:00';
  const datetimeStr = date ? `${date}T${timeValue}` : null;

  const dateFormatted = date
    ? new Date(datetimeStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const timeFormatted = date
    ? new Date(datetimeStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
    : '';

  const typesJoined = types.join(', ');

  const parts = [];
  if (dsSelected.length) parts.push(`DS: ${dsSelected.join(', ')}`);
  if (algoSelected.length) parts.push(`Algo: ${algoSelected.join(', ')}`);
  if (sysSelected.length) parts.push(`System Design: ${sysSelected.join(', ')}`);
  const dataStructure = parts.join(' | ');

  const notes = role ? `Role: ${role}` : '';

  return { date: dateFormatted, timeFormatted, datetimeStr, types: typesJoined, dataStructure, notes };
}

export async function saveInterviewDetails(cfg, token, selectedRow, interviewData) {
  const { date: interviewDate, timeFormatted, types, dataStructure, notes } = interviewData;
  const interviewDateTime = timeFormatted ? `${interviewDate} ${timeFormatted}` : interviewDate;

  const dateLogged = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeLogged = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  const dateTimeLogged = `${dateLogged} ${timeLogged}`;
  const interviewTab = 'Interviews';

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const sheet = metaData.sheets?.find(s => s.properties.title === interviewTab);
  if (!sheet) return; // No Interviews tab — skip silently
  const sheetId = sheet.properties.sheetId;

  const existingRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${interviewTab}!C:D`)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const existingData = await existingRes.json();
  const existingRows = existingData.values || [];
  const matchCount = existingRows.filter(r =>
    (r[0] || '').toLowerCase().trim() === selectedRow.company.toLowerCase().trim() &&
    (r[1] || '').toLowerCase().trim() === selectedRow.title.toLowerCase().trim()
  ).length;
  const round = matchCount + 1;

  const row = [dateTimeLogged, interviewDateTime, selectedRow.company, selectedRow.title, types, dataStructure, round, notes];

  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        inheritFromBefore: false
      } }]
    })
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${interviewTab}!A2`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}

export async function saveOfferEntry(cfg, token, activity, selectedRow) {
  const offersTab = 'Offers';
  const dateLogged = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const timeLogged = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}?fields=sheets.properties`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const metaData = await metaRes.json();
  const sheet = metaData.sheets?.find(s => s.properties.title === offersTab);
  if (!sheet) return; // No Offers tab — skip silently

  const row = [`${dateLogged} ${timeLogged}`, selectedRow.company, selectedRow.title, activity];

  const sheetId = sheet.properties.sheetId;
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{ insertDimension: {
        range: { sheetId, dimension: 'ROWS', startIndex: 1, endIndex: 2 },
        inheritFromBefore: false
      } }]
    })
  });

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent(`${offersTab}!A2`)}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [row] })
    }
  );
}
