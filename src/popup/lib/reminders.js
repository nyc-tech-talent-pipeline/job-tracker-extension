export async function scheduleInterviewReminders(interviewDate, company, role) {
  if (!chrome.alarms) return;
  const stored = await chrome.storage.local.get('interviewReminders');
  const reminders = stored.interviewReminders || [];
  if (!reminders.length || !interviewDate) return;

  const interviewMs = new Date(interviewDate).getTime();
  if (isNaN(interviewMs)) return;

  reminders.forEach((r, i) => {
    const amount = parseInt(r.amount) || 1;
    let ms = 0;
    if (r.unit === 'minutes before') ms = amount * 60 * 1000;
    else if (r.unit === 'hours before') ms = amount * 60 * 60 * 1000;
    else if (r.unit === 'days before') ms = amount * 24 * 60 * 60 * 1000;

    const alarmTime = interviewMs - ms;
    if (alarmTime <= Date.now()) return;

    const label = `${amount} ${r.unit}`;
    const alarmName = `interviewReminder-${i}-${alarmTime}`;
    chrome.storage.local.set({ [alarmName]: { company, role, label } });
    chrome.alarms.create(alarmName, { when: alarmTime });
  });
}
