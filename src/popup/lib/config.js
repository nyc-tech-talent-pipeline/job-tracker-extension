const DEFAULT_CONFIG = {
  statuses: ['❓ No Reply', '👻 Ghosted', '💼 Interview', '❌ Rejected', '🎁 Received Offer', '✅ Offer Accepted'],
  interviewStages: ['👻 Ghosted', '💼 Interview', '❌ Rejected', '🎁 Received Offer', '✅ Offer Accepted'],
  interviewTopics: ['Arrays', 'Strings', 'Hash Maps', 'Linked Lists', 'Trees', 'Graphs', 'Dynamic Programming', 'Sorting', 'BFS / DFS', 'Recursion'],
  sources: ['LinkedIn', 'Indeed', 'Handshake', 'Company Website', 'Glassdoor', 'Referral', 'Job Fair', 'Other']
};

// Loads config.json (UI config) and client-id.json (Google Client ID) separately.
// config.json is committed to the repo; client-id.json is gitignored and injected by CI.
export async function loadConfig() {
  let config;
  try {
    const res = await fetch(chrome.runtime.getURL('config.json'));
    config = await res.json();
  } catch {
    config = { ...DEFAULT_CONFIG };
  }
  try {
    const res = await fetch(chrome.runtime.getURL('client-id.json'));
    const { googleClientId } = await res.json();
    if (googleClientId) config.googleClientId = googleClientId;
  } catch {
    console.warn('[JobTracker] client-id.json not found — copy client-id.example.json to client-id.json and add your Google Client ID');
  }
  return config;
}

// Reads the extension's sync-storage-backed settings (Sheet ID, profile fields).
export function getConfig() {
  return new Promise(resolve => {
    chrome.storage.sync.get('jobTrackerConfig', r => resolve(r.jobTrackerConfig || {}));
  });
}

export async function setConfig(cfg) {
  await chrome.storage.sync.set({ jobTrackerConfig: cfg });
}

// Accepts a full Google Sheets URL or a bare ID and returns just the ID
export function extractSheetId(input) {
  if (!input) return '';
  const val = input.trim();
  const urlMatch = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (urlMatch) return urlMatch[1];
  return val.replace(/[/\s]/g, '');
}
