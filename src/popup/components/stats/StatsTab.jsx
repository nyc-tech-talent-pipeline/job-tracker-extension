import { useEffect, useState } from 'react';
import { getConfig } from '../../lib/config.js';
import { getToken } from '../../lib/auth.js';
import StatusBar from '../shared/StatusBar.jsx';

const WEEK_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dateLabel = d => d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

async function scheduleSmartReminder() {
  if (!chrome.alarms) return;
  const cfg = await getConfig();
  if (!cfg.sheetId) return;
  try {
    const token = await getToken();
    const res = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${encodeURIComponent('Applications!B:B')}?valueRenderOption=FORMATTED_VALUE`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    const times = (data.values || []).slice(1).map(r => r[0]).filter(Boolean);

    let targetHour = 20; // default 8 PM if no history
    const hours = times.map(t => {
      const m = String(t).match(/(\d+):(\d+)\s*(AM|PM)/i);
      if (!m) return null;
      let h = parseInt(m[1]);
      if (m[3].toUpperCase() === 'PM' && h !== 12) h += 12;
      if (m[3].toUpperCase() === 'AM' && h === 12) h = 0;
      return h + parseInt(m[2]) / 60;
    }).filter(h => h !== null);

    if (hours.length) {
      targetHour = Math.round(hours.reduce((a, b) => a + b, 0) / hours.length);
    }

    const when = (() => {
      const n = new Date();
      n.setHours(targetHour, 0, 0, 0);
      if (n <= new Date()) n.setDate(n.getDate() + 1);
      return n.getTime();
    })();

    chrome.alarms.clear('jobReminder', () => {
      chrome.alarms.create('jobReminder', { when, periodInMinutes: 24 * 60 });
    });
  } catch { /* silent */ }
}

async function cancelSmartReminder() {
  if (chrome.alarms) chrome.alarms.clear('jobReminder');
}

export default function StatsTab({ active }) {
  const [goal, setGoal] = useState(0);
  const [remindersEnabled, setRemindersEnabled] = useState(false);
  const [todayCount, setTodayCount] = useState(0);
  const [totalCount, setTotalCount] = useState('—');
  const [streak, setStreak] = useState(0);
  const [dayMap, setDayMap] = useState({});
  const [goalStatus, setGoalStatus] = useState(null);

  async function loadStats() {
    const cfg = await getConfig();

    const stored = await chrome.storage.local.get('goalSettings');
    const { goal: g = 0, reminders: r = false } = stored.goalSettings || {};
    setGoal(g);
    setRemindersEnabled(r);

    if (!cfg.sheetId) return;

    try {
      const token = await getToken();
      const range = encodeURIComponent('Applications!A:A');
      const res = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${cfg.sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await res.json();
      let rows = data.values || [];

      if (rows.length > 0 && /date|applied/i.test(rows[0][0] || '')) rows = rows.slice(1);

      const normaliseDate = str => {
        if (!str) return '';
        const d = new Date(str);
        if (!isNaN(d)) return dateLabel(d);
        return str.trim();
      };

      const today = dateLabel(new Date());
      const normRows = rows.map(r => normaliseDate(r[0])).filter(Boolean);
      const todayCnt = normRows.filter(d => d === today).length;

      setTotalCount(normRows.length);

      const map = {};
      normRows.forEach(d => { map[d] = (map[d] || 0) + 1; });

      let streakCount = 0;
      const d = new Date();
      const todayHit = g > 0 ? todayCnt >= g : todayCnt > 0;
      if (!todayHit) d.setDate(d.getDate() - 1);
      for (let i = 0; i < 365; i++) {
        const label = dateLabel(d);
        const count = map[label] || 0;
        if (g > 0 ? count < g : count === 0) break;
        streakCount++;
        d.setDate(d.getDate() - 1);
      }

      setTodayCount(todayCnt);
      setStreak(streakCount);
      setDayMap(map);
    } catch { /* silent */ }
  }

  useEffect(() => {
    if (active) loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  async function saveGoal() {
    await chrome.storage.local.set({ goalSettings: { goal, reminders: remindersEnabled } });
    if (remindersEnabled) await scheduleSmartReminder();
    else await cancelSmartReminder();
    setGoalStatus({ type: 'success', message: '✅ Goal saved' });
    await loadStats();
  }

  const streakEmoji = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '📋';
  const streakSub = streak === 0
    ? 'Start logging to build your streak'
    : streak === 1 ? 'Keep it up — log again tomorrow!'
    : `${streak} days in a row — great work!`;
  const pct = goal > 0 ? Math.min(100, Math.round(todayCount / goal * 100)) : 0;
  const todayStatusMsg = !goal
    ? 'Set a daily goal below to track progress'
    : todayCount >= goal
    ? `🎉 Goal reached! ${todayCount} logged today`
    : `${goal - todayCount} more to hit your goal today`;

  return (
    <div id="panel-stats" className={active ? 'panel active' : 'panel'}>
      <div className="section">
        <div className="section-title">Today</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 8, background: '#f0f0f0', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#1a73e8', borderRadius: 4, width: `${pct}%`, transition: 'width 0.4s' }} />
          </div>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#444' }}>{todayCount} / {goal || '?'}</div>
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 6 }}>{todayStatusMsg}</div>
      </div>

      <div className="section">
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#fff8e1', borderRadius: 10 }}>
            <div style={{ fontSize: 26 }}>{streakEmoji}</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#e65100' }}>{streak}</div>
              <div style={{ fontSize: 11, color: '#a06000', fontWeight: 500 }}>day streak</div>
            </div>
          </div>
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: 12, background: '#e8f0fe', borderRadius: 10 }}>
            <div style={{ fontSize: 26 }}>📋</div>
            <div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#1a55a3' }}>{totalCount}</div>
              <div style={{ fontSize: 11, color: '#3367d6', fontWeight: 500 }}>total logged</div>
            </div>
          </div>
        </div>
        <div style={{ fontSize: 11, color: '#aaa', marginTop: 8, textAlign: 'center' }}>{streakSub}</div>
      </div>

      <div className="section">
        <div className="section-title">Daily goal</div>
        <div className="edit-row">
          <label>Applications per day</label>
          <input
            className="field-edit" type="number" min="1" max="50" placeholder="e.g. 3" style={{ width: 70 }}
            value={goal || ''} onChange={e => setGoal(parseInt(e.target.value) || 0)}
          />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 500 }}>Smart reminders</div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 1 }}>Notifies you based on your usual application time</div>
          </div>
          <label className="toggle-switch" style={{ flexShrink: 0 }}>
            <input type="checkbox" checked={remindersEnabled} onChange={e => setRemindersEnabled(e.target.checked)} />
            <span className="toggle-slider" />
          </label>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 10, width: '100%' }} onClick={saveGoal}>Save Goal</button>
        <div style={{ marginTop: 6 }}><StatusBar status={goalStatus} /></div>
      </div>

      <div className="section">
        <div className="section-title">This week</div>
        <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', marginTop: 4 }}>
          {Array.from({ length: 7 }, (_, idx) => 6 - idx).map(i => {
            const d = new Date();
            d.setDate(d.getDate() - i);
            const label = dateLabel(d);
            const count = dayMap[label] || 0;
            const hit = goal > 0 ? count >= goal : count > 0;
            const isToday = i === 0;
            return (
              <div
                key={i}
                style={{
                  flex: 1, textAlign: 'center', padding: '6px 2px', borderRadius: 6,
                  background: hit ? '#1a73e8' : isToday ? '#f0f4ff' : '#f5f5f5',
                  border: isToday ? '1.5px solid #1a73e8' : '1px solid transparent'
                }}
              >
                <div style={{ fontSize: 10, color: hit ? '#fff' : '#888', fontWeight: 500 }}>{WEEK_DAYS[d.getDay()]}</div>
                <div style={{ fontSize: 14, fontWeight: 700, color: hit ? '#fff' : '#bbb', marginTop: 2 }}>{count}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
