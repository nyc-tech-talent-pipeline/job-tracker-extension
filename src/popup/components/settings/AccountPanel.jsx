import { useEffect, useState } from 'react';
import { extractSheetId, setConfig } from '../../lib/config.js';
import { getToken, connectGoogle, disconnectGoogle } from '../../lib/auth.js';
import StatusBar from '../shared/StatusBar.jsx';
import Spinner from '../shared/Spinner.jsx';

export default function AccountPanel({ fields, setField }) {
  const [connectedEmail, setConnectedEmail] = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState(null);

  useEffect(() => {
    (async () => {
      const stored = await chrome.storage.local.get(['googleAuth', 'googleEmail']);
      const email = stored.googleAuth?.email || stored.googleEmail || null;
      if (email) setConnectedEmail(email);
    })();

    // Fires if the popup stays open while the OAuth window is open; if the
    // popup was closed, the effect above picks it up on next open instead.
    function onChanged(changes, area) {
      if (area !== 'local' || !changes.authFlowResult?.newValue) return;
      const result = changes.authFlowResult.newValue;
      setConnecting(false);
      if (result.success) {
        setConnectedEmail(result.email);
        setAuthStatus({ type: 'success', message: '✅ Connected as ' + result.email });
      } else {
        setAuthStatus({ type: 'error', message: `❌ ${result.error || 'Sign-in failed'}` });
      }
      chrome.storage.local.remove('authFlowResult');
    }
    chrome.storage.onChanged.addListener(onChanged);
    return () => chrome.storage.onChanged.removeListener(onChanged);
  }, []);

  async function handleConnect() {
    setConnecting(true);
    try {
      await connectGoogle();
      setAuthStatus({ type: 'info', message: '🔑 Google sign-in window opened — complete sign-in then reopen the extension if needed' });
    } catch (err) {
      setAuthStatus({ type: 'error', message: `❌ ${err.message}` });
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    await disconnectGoogle();
    setConnectedEmail(null);
    setAuthStatus({ type: 'info', message: 'Google account disconnected' });
  }

  async function handleVerify() {
    const sheetId = extractSheetId(fields.sheetId);
    if (!sheetId) {
      setSettingsStatus({ type: 'error', message: '⚠️ Enter a Sheet ID first' });
      return;
    }
    setField('sheetId', sheetId);

    setVerifying(true);
    try {
      const token = await getToken();
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=properties.title,sheets.properties.title`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (res.status === 404) {
        setSettingsStatus({ type: 'error', message: '❌ Sheet not found — check the ID' });
        return;
      }
      if (res.status === 403) {
        setSettingsStatus({ type: 'error', message: "❌ No access — make sure it's your sheet" });
        return;
      }
      if (!res.ok) {
        const err = await res.json();
        setSettingsStatus({ type: 'error', message: `❌ ${err.error?.message || 'Could not open sheet'}` });
        return;
      }

      const data = await res.json();
      const title = data.properties?.title || 'Untitled';
      const tabs = (data.sheets || []).map(s => s.properties.title);
      const required = ['Applications', 'Interviews', 'Offers'];
      const missing = required.filter(t => !tabs.includes(t));

      // Persist the verified ID so logging uses the exact same one
      await setConfig({ ...fields, sheetId });

      if (missing.length === 0) {
        setSettingsStatus({ type: 'success', message: `✅ "${title}" — saved & verified, all tabs found` });
      } else {
        setSettingsStatus({ type: 'error', message: `⚠️ "${title}" saved but missing tab${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` });
      }
    } catch (err) {
      setSettingsStatus({ type: 'error', message: `❌ ${err.message}` });
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave() {
    const sheetId = extractSheetId(fields.sheetId);
    setField('sheetId', sheetId);
    await setConfig({ ...fields, sheetId });
    setSettingsStatus({ type: 'success', message: '✅ Settings saved' });
  }

  return (
    <>
      <div className="section">
        <div className="section-title">Google account</div>
        {!connectedEmail ? (
          <div id="google-auth-row">
            <button className="btn btn-secondary" disabled={connecting} onClick={handleConnect}>
              <svg width="16" height="16" viewBox="0 0 24 24" style={{ flexShrink: 0 }}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              <span>{connecting ? 'Connecting…' : 'Connect Google Account'}</span>
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#34a853', flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: '#1a1a1a', fontWeight: 500 }}>{connectedEmail}</span>
            <button
              onClick={handleDisconnect}
              style={{ background: 'none', border: 'none', fontSize: 11, color: '#888', cursor: 'pointer', marginLeft: 'auto', padding: '2px 4px' }}
            >
              Disconnect
            </button>
          </div>
        )}
        <div style={{ marginTop: 8 }}><StatusBar status={authStatus} /></div>
      </div>

      <div className="section">
        <div className="section-title">Google Sheet</div>
        <div className="edit-row">
          <label>Sheet ID</label>
          <input className="field-edit" placeholder="Paste your Sheet ID here" value={fields.sheetId} onChange={e => setField('sheetId', e.target.value)} />
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button className="btn btn-secondary" style={{ flex: 1 }} disabled={verifying} onClick={handleVerify}>
            {verifying ? (<><Spinner /> Checking…</>) : '🔍 Verify'}
          </button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSave}>Save</button>
        </div>
        <div style={{ marginTop: 8 }}><StatusBar status={settingsStatus} /></div>
      </div>
    </>
  );
}
