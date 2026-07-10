import { useEffect, useState } from 'react';
import { getConfig } from '../../lib/config.js';
import AccountPanel from './AccountPanel.jsx';
import ProfilePanel from './ProfilePanel.jsx';
import PreferencesPanel from './PreferencesPanel.jsx';

const SUB_TABS = [
  { key: 'account', label: 'Account' },
  { key: 'profile', label: 'Profile' },
  { key: 'preferences', label: 'Preferences' }
];

const EMPTY_FIELDS = { sheetId: '', name: '', email: '', phone: '', address: '', linkedin: '', website: '' };

export default function SettingsTab({ active, showOnboarding }) {
  const [subTab, setSubTab] = useState('account');
  const [fields, setFields] = useState(EMPTY_FIELDS);

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      setFields({
        sheetId: cfg.sheetId || '',
        name: cfg.name || '',
        email: cfg.email || '',
        phone: cfg.phone || '',
        address: cfg.address || '',
        linkedin: cfg.linkedin || '',
        website: cfg.website || ''
      });
    })();
  }, []);

  function setField(key, value) {
    setFields(prev => ({ ...prev, [key]: value }));
  }

  return (
    <div id="panel-settings" className={active ? 'panel active' : 'panel'}>
      {showOnboarding && (
        <div style={{ background: '#e8f0fe', borderBottom: '1px solid #c5d8f8', padding: '12px 16px', fontSize: 12, color: '#1a55a3' }}>
          <strong>👋 Welcome to Job Tracker!</strong><br />
          Connect your Google Sheet below to get started.
          <a href="https://sheets.google.com" target="_blank" rel="noreferrer" style={{ color: '#1a73e8', marginLeft: 4 }}>Create a sheet →</a>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, padding: '10px 12px', borderBottom: '0.5px solid #f0f0f0', background: '#fafafa' }}>
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            className={`settings-tab-btn${subTab === t.key ? ' active' : ''}`}
            style={{
              padding: '4px 14px', borderRadius: 20, fontSize: 11,
              fontWeight: subTab === t.key ? 500 : 400,
              border: subTab === t.key ? '0.5px solid #1a73e8' : '0.5px solid #ddd',
              background: subTab === t.key ? '#1a73e8' : 'none',
              color: subTab === t.key ? '#fff' : '#666',
              cursor: 'pointer'
            }}
            onClick={() => setSubTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: subTab === 'account' ? 'block' : 'none' }}>
        <AccountPanel fields={fields} setField={setField} />
      </div>
      <div style={{ display: subTab === 'profile' ? 'block' : 'none' }}>
        <ProfilePanel fields={fields} setField={setField} />
      </div>
      <div style={{ display: subTab === 'preferences' ? 'block' : 'none' }}>
        <PreferencesPanel />
      </div>
    </div>
  );
}
