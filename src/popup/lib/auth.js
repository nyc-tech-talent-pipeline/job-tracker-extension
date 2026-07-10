import { getGoogleClientId } from './appConfig.js';

export async function getToken() {
  const stored = await chrome.storage.local.get('googleAuth');
  const auth = stored.googleAuth;

  // Token still fresh — return directly
  if (auth?.token && auth.issuedAt && Date.now() - auth.issuedAt < 55 * 60 * 1000) {
    return auth.token;
  }

  if (!auth?.email) {
    throw new Error('Not signed in — connect Google in Settings');
  }

  // Token expired — try SILENT re-auth first (no UI), fall back to interactive
  const buildAuthUrl = (silent) => {
    const url = new URL('https://accounts.google.com/o/oauth2/auth');
    url.searchParams.set('client_id', getGoogleClientId());
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('redirect_uri', chrome.identity.getRedirectURL());
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/spreadsheets email profile');
    url.searchParams.set('login_hint', auth.email);
    if (silent) url.searchParams.set('prompt', 'none');
    return url.toString();
  };

  const tryAuth = (silent) => new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'launchAuthFlow', url: buildAuthUrl(silent), interactive: !silent },
      response => {
        if (!response || response.error || !response.responseUrl) { resolve(null); return; }
        const token = new URLSearchParams(new URL(response.responseUrl).hash.slice(1)).get('access_token');
        resolve(token || null);
      }
    );
  });

  let token = await tryAuth(true);
  if (!token) token = await tryAuth(false);

  if (!token) {
    await chrome.storage.local.remove(['googleAuth', 'googleEmail']);
    throw new Error('Session expired — please reconnect Google in Settings');
  }

  await chrome.storage.local.set({ googleAuth: { ...auth, token, issuedAt: Date.now() } });
  return token;
}

// Fire-and-forget — the service worker runs the OAuth flow and writes the
// result to chrome.storage.local (authFlowResult), since the popup may close
// while the OAuth window is open.
export async function connectGoogle() {
  await chrome.storage.local.remove('authFlowResult');
  chrome.runtime.sendMessage({
    action: 'startAuthFlow',
    clientId: getGoogleClientId(),
    redirectUrl: chrome.identity.getRedirectURL()
  });
}

export async function disconnectGoogle() {
  const stored = await chrome.storage.local.get('googleAuth');
  if (stored.googleAuth?.token) {
    fetch(`https://accounts.google.com/o/oauth2/revoke?token=${stored.googleAuth.token}`).catch(() => {});
  }
  await chrome.storage.local.remove(['googleAuth', 'googleEmail']);
}
