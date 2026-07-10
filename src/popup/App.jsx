import { useEffect, useState } from 'react';
import { loadConfig, getConfig } from './lib/config.js';
import { setGoogleClientId } from './lib/appConfig.js';
import TabBar from './components/TabBar.jsx';
import LogTab from './components/log/LogTab.jsx';
import StatusTab from './components/status/StatusTab.jsx';
import StatsTab from './components/stats/StatsTab.jsx';
import SettingsTab from './components/settings/SettingsTab.jsx';

export default function App() {
  const [activeTab, setActiveTab] = useState('log');
  const [showOnboarding, setShowOnboarding] = useState(false);

  useEffect(() => {
    (async () => {
      const config = await loadConfig();
      setGoogleClientId(config.googleClientId);
      const cfg = await getConfig();
      if (!cfg.sheetId) {
        setActiveTab('settings');
        setShowOnboarding(true);
      }
    })();
  }, []);

  return (
    <>
      <div className="header">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="7" width="18" height="14" rx="2" fill="rgba(255,255,255,0.25)" stroke="white" strokeWidth="1.5" />
          <path d="M8 7V5a4 4 0 018 0v2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          <path d="M12 13v2M9 13h6" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <div>
          <h1>Job Tracker</h1>
          <p>Detect · Autofill · Log · Track Interviews</p>
        </div>
      </div>

      <TabBar active={activeTab} onChange={setActiveTab} />

      <LogTab active={activeTab === 'log'} />
      <StatusTab active={activeTab === 'interview'} />
      <StatsTab active={activeTab === 'stats'} />
      <SettingsTab active={activeTab === 'settings'} showOnboarding={showOnboarding} />
    </>
  );
}
