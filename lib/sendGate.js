const store = require('./store');
const logger = require('./logger');
const { MIN_GAP_MS, WINDOW_MS, MAX_IN_WINDOW } = require('./randomScheduler');
const sendHours = require('./sendHours');

// Global pacing gate every outgoing cold email passes through, regardless of
// how it was scheduled ("send now", fixed time, or randomized window):
//   - consecutive sends are at least MIN_GAP_MS (4 min) apart, plus a little
//     random jitter so the cadence doesn't look robotic
//   - no rolling WINDOW_MS (20 min) span ever contains more than
//     MAX_IN_WINDOW (5) sends
// The limits apply ACROSS jobs - two jobs running at once still share one lane.

let sendTimes = null; // ms timestamps of recent sends, oldest first
let queue = Promise.resolve();
let waitingCount = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// On startup, replay recent sends from the store so a restart can't be used
// to burst past the rolling-window limit.
function seed() {
  if (sendTimes) return;
  sendTimes = [];
  const cutoff = Date.now() - WINDOW_MS - MIN_GAP_MS;
  try {
    for (const job of store.listJobs()) {
      for (const r of job.recipients || []) {
        if (r.status === 'sent' && typeof r.sentAt === 'string') {
          const t = new Date(r.sentAt).getTime();
          if (Number.isFinite(t) && t > cutoff) sendTimes.push(t);
        }
      }
    }
    sendTimes.sort((a, b) => a - b);
    if (sendTimes.length > 0) {
      logger.info(`Send gate: seeded with ${sendTimes.length} recent send(s) from the last ${Math.round((WINDOW_MS + MIN_GAP_MS) / 60000)} min`);
    }
  } catch (err) {
    logger.error(`Send gate: could not seed recent sends from store: ${err.message}`);
  }
}

function prune(now) {
  const cutoff = now - WINDOW_MS - MIN_GAP_MS;
  while (sendTimes.length > 1 && sendTimes[0] < cutoff) sendTimes.shift();
}

// Earliest timestamp the next send is allowed at, given past sends.
function nextAllowedAt(now) {
  let t = now;
  if (sendTimes.length > 0) {
    t = Math.max(t, sendTimes[sendTimes.length - 1] + MIN_GAP_MS);
  }
  if (sendTimes.length >= MAX_IN_WINDOW) {
    t = Math.max(t, sendTimes[sendTimes.length - MAX_IN_WINDOW] + WINDOW_MS);
  }
  return t;
}

// Waits until this send is allowed under the pacing rules, then claims the
// slot. Calls are strictly serialized, so concurrent jobs can't both grab
// the same slot. `label` is only used for logging (e.g. "job 123 -> a@b.com").
function acquireSendSlot(label) {
  waitingCount++;
  const acquired = queue.then(async () => {
    waitingCount--;
    seed();
    const now = Date.now();
    prune(now);
    // Humanize: 0-30s of extra random delay on top of the hard minimum, so
    // consecutive sends never land a machine-perfect 4:00 apart.
    const jitter = Math.round(Math.random() * 30000);
    let allowedAt = nextAllowedAt(now) + (sendTimes.length > 0 ? jitter : 0);

    // Business-hours guard: emails sent at 3 a.m. or on weekends are a
    // classic automation fingerprint (and nobody reads them anyway), so a
    // send that comes due outside the allowed hours is held - not dropped -
    // until the window opens again.
    const hoursAdjusted = sendHours.nextAllowedTime(new Date(allowedAt)).getTime();
    if (hoursAdjusted > allowedAt) {
      logger.info(
        `Send gate: ${label} falls outside sending hours (${sendHours.describe()}) - ` +
          `holding it until ${new Date(hoursAdjusted).toLocaleString()} so the send looks (and is) human-timed`
      );
      allowedAt = hoursAdjusted;
    }

    const waitMs = Math.max(0, allowedAt - now);
    if (waitMs > 1000) {
      logger.info(
        `Send gate: ${label} waiting ${Math.round(waitMs / 1000)}s for its slot ` +
          `(rule: >=${MIN_GAP_MS / 60000} min between sends, max ${MAX_IN_WINDOW} per ${WINDOW_MS / 60000} min - ` +
          `steady drip avoids the burst pattern spam filters flag${waitingCount > 0 ? `; ${waitingCount} other send(s) queued` : ''})`
      );
      await sleep(waitMs);
    }
    sendTimes.push(Date.now());
    logger.info(`Send gate: slot granted to ${label}`);
  });
  // Keep the chain alive even if a waiter's downstream code throws.
  queue = acquired.catch(() => {});
  return acquired;
}

// Rough ETA (ms from now) until n more sends could complete, for logging.
function estimateDurationMs(n) {
  seed();
  const now = Date.now();
  prune(now);
  const times = [...sendTimes];
  let last = now;
  for (let i = 0; i < n; i++) {
    let t = last;
    if (times.length > 0) t = Math.max(t, times[times.length - 1] + MIN_GAP_MS);
    if (times.length >= MAX_IN_WINDOW) t = Math.max(t, times[times.length - MAX_IN_WINDOW] + WINDOW_MS);
    times.push(t);
    last = t;
  }
  return last - now;
}

module.exports = { acquireSendSlot, estimateDurationMs };
