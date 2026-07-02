// Business-hours send guard.
//
// WHY: real people email recruiters during working hours. A "cold email" that
// arrives at 2:47 a.m., or a batch that runs straight through a weekend, is a
// classic automation fingerprint - spam filters score on it, and even when it
// lands, a 3 a.m. timestamp reads as a bot to the human opening it. So every
// send (whatever the scheduling mode) is held until it falls inside the
// allowed window; the send gate simply waits and logs why.
//
// Configure with SEND_HOURS_START / SEND_HOURS_END ("HH:MM", local time) and
// SEND_ON_WEEKENDS (default false - recruiters aren't reading on Saturday
// anyway, so weekend sends spend reputation for nothing). Set
// SEND_HOURS_START and SEND_HOURS_END to empty strings to disable the guard.

function parseHHMM(value, fallbackMinutes) {
  if (typeof value !== 'string') return fallbackMinutes;
  const m = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallbackMinutes;
  const mins = Number(m[1]) * 60 + Number(m[2]);
  return mins >= 0 && mins < 24 * 60 ? mins : fallbackMinutes;
}

function config() {
  const rawStart = process.env.SEND_HOURS_START;
  const rawEnd = process.env.SEND_HOURS_END;
  // Both explicitly set to empty = guard off (send at any hour).
  if (rawStart === '' && rawEnd === '') return { enabled: false };
  return {
    enabled: true,
    startMin: parseHHMM(rawStart, 9 * 60), // default 09:00
    endMin: parseHHMM(rawEnd, 18 * 60), // default 18:00
    weekends: String(process.env.SEND_ON_WEEKENDS || 'false').toLowerCase() === 'true',
  };
}

function isWorkday(date, cfg) {
  const day = date.getDay(); // 0 Sun, 6 Sat
  return cfg.weekends || (day !== 0 && day !== 6);
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// Is sending allowed at this moment?
function isAllowed(date = new Date()) {
  const cfg = config();
  if (!cfg.enabled) return true;
  if (!isWorkday(date, cfg)) return false;
  const mins = minutesOfDay(date);
  return mins >= cfg.startMin && mins < cfg.endMin;
}

// Earliest allowed moment at or after `date`.
function nextAllowedTime(date = new Date()) {
  const cfg = config();
  if (!cfg.enabled) return date;
  const d = new Date(date.getTime());
  for (let i = 0; i < 8; i++) {
    // up to a week of scanning forward, day by day
    if (isWorkday(d, cfg)) {
      const mins = minutesOfDay(d);
      if (mins < cfg.startMin) {
        d.setHours(Math.floor(cfg.startMin / 60), cfg.startMin % 60, 0, 0);
        return d;
      }
      if (mins < cfg.endMin) return d; // already inside the window
    }
    // Past today's window (or a weekend): try the start of the next day.
    d.setDate(d.getDate() + 1);
    d.setHours(Math.floor(cfg.startMin / 60), cfg.startMin % 60, 0, 0);
  }
  return d;
}

// Human-readable description for logs and the UI.
function describe() {
  const cfg = config();
  if (!cfg.enabled) return 'sending allowed at any hour (guard disabled)';
  const fmt = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  return `${fmt(cfg.startMin)}-${fmt(cfg.endMin)} ${cfg.weekends ? 'every day' : 'Mon-Fri'}`;
}

module.exports = { isAllowed, nextAllowedTime, describe };
