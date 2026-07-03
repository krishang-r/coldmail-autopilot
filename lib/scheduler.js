const fs = require('fs');
const path = require('path');
const store = require('./store');
const { getTransporter, sendOne } = require('./mailer');
const logger = require('./logger');
const { notify } = require('./notify');
const sendGate = require('./sendGate');
const bounceWatcher = require('./bounceWatcher');
const sendHours = require('./sendHours');

// --- Single-instance lock ---------------------------------------------------
// CRITICAL: the send gate, the `running` set and the "already sent" checks are
// all per-process. If two copies of the app run at once (e.g. the LaunchAgent
// plus a stray `npm run dev` / `npm start`), each has its own scheduler and
// they race on the shared data/db.json - both read a recipient as "pending"
// and both send it, so the same email goes out 2-4 times. This lock makes the
// scheduler refuse to run in more than one process at a time, so at most one
// process ever sends. (The HTTP port isn't enough: during restarts it's
// briefly free, which is exactly when a second sender can slip in.)
const LOCK_PATH = path.join(__dirname, '..', 'data', 'scheduler.lock');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0); // signal 0 = liveness probe, doesn't actually signal
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // exists but owned by someone else = still alive
  }
}

function acquireSchedulerLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const held = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
      if (held && held.pid && held.pid !== process.pid && isProcessAlive(held.pid)) {
        return { ok: false, heldBy: held.pid };
      }
      // Otherwise the previous holder is gone (crash/kill) - lock is stale, take it.
    }
  } catch {
    // Corrupt/unreadable lock file: treat as free and overwrite.
  }
  fs.mkdirSync(path.dirname(LOCK_PATH), { recursive: true });
  fs.writeFileSync(LOCK_PATH, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  return { ok: true };
}

function releaseSchedulerLock() {
  try {
    const held = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
    if (held && held.pid === process.pid) fs.unlinkSync(LOCK_PATH);
  } catch {
    // Nothing to release / already gone.
  }
}

// 'fallback' recipients are standbys - they only send if a bounce promotes
// them - so they neither get sent in the normal pass nor block completion.
function isSettled(r) {
  return ['sent', 'failed', 'bounced', 'fallback'].includes(r.status);
}

// A synchronous 5xx from Gmail at submission time (e.g. gmail-to-gmail
// "address not found") is a bounce we don't have to wait for - hand it to the
// same fallback-promotion path the async bounce watcher uses.
function isHardRejection(err) {
  return Number(err && err.responseCode) >= 500;
}

const POLL_INTERVAL_MS = 15000;
const running = new Set();
const sendingKeys = new Set();

// --- Daily volume cap -------------------------------------------------------
// Going over the account's daily send limit (~500/day for a free gmail.com
// account, 2000 for Workspace) gets you temporarily blocked and damages sender
// reputation, which is a fast track to the spam folder. Default to a safe 450;
// set DAILY_SEND_LIMIT=0 to disable the cap entirely.
function dailyLimit() {
  const n = Number(process.env.DAILY_SEND_LIMIT);
  return Number.isFinite(n) && n >= 0 ? n : 450;
}

// --- Warm-up ramp ------------------------------------------------------------
// WHY: mailbox providers judge senders by history. An account that normally
// sends a handful of emails a day and suddenly blasts hundreds looks exactly
// like a compromised or freshly-bought spam account, and gets throttled or
// spam-foldered even if every message is fine. The fix is to ramp: start
// small and roughly double each week, so the account builds a track record.
// The ramp starts at WARMUP_START_LIMIT (default 20) on the week of the first
// send ever made through this app and doubles weekly until it reaches
// DAILY_SEND_LIMIT. Set WARMUP_START_LIMIT=0 to disable the ramp.
function warmupStatus() {
  const start = Number(process.env.WARMUP_START_LIMIT);
  const startLimit = Number.isFinite(start) && start >= 0 ? start : 20;
  const base = dailyLimit();
  if (startLimit === 0 || base === 0) return { active: false, limit: base };

  const firstSend = store.firstSendAt();
  // No sends yet: week 0 of the ramp.
  const week = firstSend
    ? Math.floor((Date.now() - firstSend.getTime()) / (7 * 24 * 60 * 60 * 1000))
    : 0;
  const rampLimit = startLimit * 2 ** Math.max(0, week);
  if (rampLimit >= base) return { active: false, limit: base };
  return { active: true, week: week + 1, limit: rampLimit, fullLimit: base };
}

// The cap actually enforced today: the warm-up ramp while it's below the
// configured DAILY_SEND_LIMIT, the configured limit afterwards.
function effectiveDailyLimit() {
  return warmupStatus().limit;
}

function dailyCapReached() {
  const limit = effectiveDailyLimit();
  return limit > 0 && store.countSentToday() >= limit;
}

function getDailySendStatus() {
  const warmup = warmupStatus();
  const sentToday = store.countSentToday();
  return {
    sentToday,
    dailyLimit: warmup.limit,
    remaining: warmup.limit > 0 ? Math.max(0, warmup.limit - sentToday) : null,
    capEnabled: warmup.limit > 0,
    warmup: warmup.active ? { week: warmup.week, limit: warmup.limit, fullLimit: warmup.fullLimit } : null,
  };
}

// The job may have been cancelled (deleted) from the UI while we were waiting
// out the 4-minute spacing - check the store before every send.
function jobStillExists(jobId) {
  return Boolean(store.getJob(jobId));
}

async function runJob(job) {
  if (running.has(job.id)) return;
  if (dailyCapReached()) {
    // Hold the job until the cap clears rather than blowing past the limit.
    const w = warmupStatus();
    logger.info(
      `Job ${job.id}: daily send cap (${w.limit}${w.active ? `, warm-up week ${w.week} of ramping to ${w.fullLimit}` : ''}) already reached, pausing before start`
    );
    store.updateJob(job.id, (j) => {
      if (j.status === 'pending') j.status = 'paused_daily_limit';
    });
    return;
  }
  running.add(job.id);

  const pendingCount = job.recipients.filter((r) => r.status === 'pending').length;
  const etaMin = Math.ceil(sendGate.estimateDurationMs(pendingCount) / 60000);
  logger.info(
    `Job ${job.id} ("${job.subject}") starting: ${pendingCount} of ${job.recipients.length} recipient(s) still to send, ` +
      `estimated ~${etaMin} min at the enforced pace (>=4 min apart, max 5 per 20 min)`
  );
  store.updateJob(job.id, (j) => {
    j.status = 'sending';
  });

  let transporter;
  try {
    transporter = getTransporter();
    logger.info(`Job ${job.id}: SMTP transporter ready (sending as ${process.env.GMAIL_USER})`);
  } catch (err) {
    logger.error(`Job ${job.id} could not start: ${err.message}`);
    notify('Coldmail Autopilot - config error', err.message);
    store.updateJob(job.id, (j) => {
      j.recipients.forEach((r) => {
        if (r.status === 'pending') {
          r.status = 'failed';
          r.error = err.message;
        }
      });
      j.status = 'error';
      j.error = err.message;
    });
    running.delete(job.id);
    return;
  }

  let position = 0;
  for (const recipient of job.recipients) {
    position++;
    if (recipient.status !== 'pending') continue;
    if (!jobStillExists(job.id)) {
      logger.info(`Job ${job.id}: cancelled while sending, stopping before ${recipient.email}`);
      running.delete(job.id);
      return;
    }
    if (dailyCapReached()) {
      const w = warmupStatus();
      logger.info(
        `Job ${job.id}: daily send cap (${w.limit}${w.active ? `, warm-up week ${w.week} - the cap grows weekly to protect the account's sender reputation` : ''}) reached, pausing remaining recipients until it resets`
      );
      notify(
        'Coldmail Autopilot - daily limit reached',
        `Daily send cap hit. Remaining emails for "${job.subject}" will resume automatically once the count resets.`
      );
      store.updateJob(job.id, (j) => {
        j.status = 'paused_daily_limit';
      });
      running.delete(job.id);
      return;
    }

    // All sends - regardless of scheduling mode - go through the shared gate:
    // at least 4 minutes between sends, at most 5 in any 20-minute span.
    await sendGate.acquireSendSlot(`job ${job.id} -> ${recipient.email} (${position}/${job.recipients.length})`);

    // Re-check cancellation after the (possibly minutes-long) wait.
    if (!jobStillExists(job.id)) {
      logger.info(`Job ${job.id}: cancelled while waiting for a send slot, stopping before ${recipient.email}`);
      running.delete(job.id);
      return;
    }

    try {
      logger.info(`Job ${job.id}: sending to ${recipient.email} (${position}/${job.recipients.length})`);
      const info = await sendOne(transporter, {
        to: recipient.email,
        subject: job.subject,
        body: job.body,
        company: recipient.company || '',
        attachment: job.attachment,
      });
      logger.info(`Job ${job.id}: sent to ${recipient.email} (messageId ${info && info.messageId ? info.messageId : 'n/a'})`);
      store.updateJob(job.id, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'sent';
        r.sentAt = new Date().toISOString();
      });
      store.recordSentEmail({ email: recipient.email, company: recipient.company, subject: job.subject });
    } catch (err) {
      if (isHardRejection(err)) {
        logger.error(`Job ${job.id}: ${recipient.email} rejected outright (${err.responseCode}) - treating as a bounce`);
        bounceWatcher.handleBounce(job.id, recipient.email, `rejected at send time: ${err.message}`);
      } else {
        logger.error(`Job ${job.id}: failed to send to ${recipient.email} - ${err.message}`);
        store.updateJob(job.id, (j) => {
          const r = j.recipients.find((x) => x.email === recipient.email);
          r.status = 'failed';
          r.error = err.message;
        });
      }
    }
  }

  running.delete(job.id);
  if (!jobStillExists(job.id)) return;

  // A bounce during the run may have promoted a fallback back to 'pending' -
  // in that case the job isn't done; leave it for the next tick to pick up.
  const finished = store.getJob(job.id);
  const stillPending = finished.recipients.filter((r) => r.status === 'pending').length;
  if (stillPending > 0) {
    logger.info(`Job ${job.id}: ${stillPending} promoted fallback(s) still pending, job stays open`);
    store.updateJob(job.id, (j) => {
      j.status = 'pending';
    });
    return;
  }

  const failedCount = finished.recipients.filter((r) => ['failed', 'bounced'].includes(r.status)).length;
  const sentCount = finished.recipients.filter((r) => r.status === 'sent').length;
  const standbyCount = finished.recipients.filter((r) => r.status === 'fallback').length;
  store.updateJob(job.id, (j) => {
    const anyFailed = j.recipients.some((r) => ['failed', 'bounced'].includes(r.status));
    j.status = anyFailed ? 'completed_with_errors' : 'completed';
    j.completedAt = new Date().toISOString();
  });
  logger.info(
    `Job ${job.id} finished: ${sentCount} sent, ${failedCount} failed/bounced` +
      (standbyCount > 0 ? `, ${standbyCount} unused fallback(s)` : '') +
      ` (bounce watcher keeps checking recent sends for a while)`
  );
  if (failedCount > 0) {
    notify(
      'Coldmail Autopilot - send errors',
      `${failedCount} of ${finished.recipients.length} email(s) failed/bounced for "${job.subject}". Check logs/activity.log.`
    );
  }
}

// Randomized jobs don't run as one atomic batch - each recipient has its own
// sendAt spread across the window, so they're dispatched independently as
// each one comes due. They still pass through the same global send gate, so
// even times that were randomized close together (or that collide with
// another running job) get spaced out at send time.
async function sendRandomOne(jobId, email) {
  const key = `${jobId}:${email}`;
  if (sendingKeys.has(key)) return;
  sendingKeys.add(key);
  try {
    const job = store.getJob(jobId);
    if (!job) return;
    const recipient = job.recipients.find((r) => r.email === email);
    if (!recipient || recipient.status !== 'pending') return;

    // Over the daily cap: leave this recipient pending and let a later tick
    // retry it once the count resets (its sendAt is already in the past).
    if (dailyCapReached()) {
      logger.info(`Job ${jobId}: ${email} is due but the daily cap is reached - will retry after reset`);
      return;
    }

    let transporter;
    try {
      transporter = getTransporter();
    } catch (err) {
      logger.error(`Job ${jobId}: config error - ${err.message}`);
      notify('Coldmail Autopilot - config error', err.message);
      store.updateJob(jobId, (j) => {
        j.recipients.forEach((r) => {
          if (r.status === 'pending') {
            r.status = 'failed';
            r.error = err.message;
          }
        });
        j.status = 'error';
        j.error = err.message;
      });
      return;
    }

    store.updateJob(jobId, (j) => {
      j.status = 'sending';
    });

    logger.info(`Job ${jobId}: ${email} reached its randomized slot (planned ${recipient.sendAt})`);
    await sendGate.acquireSendSlot(`job ${jobId} -> ${email} (randomized)`);

    // The job may have been cancelled while we waited for the slot.
    if (!store.getJob(jobId)) {
      logger.info(`Job ${jobId}: cancelled while waiting for a send slot, skipping ${email}`);
      return;
    }

    try {
      logger.info(`Job ${jobId}: sending to ${email}`);
      const info = await sendOne(transporter, {
        to: recipient.email,
        subject: job.subject,
        body: job.body,
        company: recipient.company || '',
        attachment: job.attachment,
      });
      logger.info(`Job ${jobId}: sent to ${recipient.email} (messageId ${info && info.messageId ? info.messageId : 'n/a'})`);
      store.updateJob(jobId, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'sent';
        r.sentAt = new Date().toISOString();
      });
      store.recordSentEmail({ email: recipient.email, company: recipient.company, subject: job.subject });
    } catch (err) {
      if (isHardRejection(err)) {
        logger.error(`Job ${jobId}: ${recipient.email} rejected outright (${err.responseCode}) - treating as a bounce`);
        bounceWatcher.handleBounce(jobId, recipient.email, `rejected at send time: ${err.message}`);
      } else {
        logger.error(`Job ${jobId}: failed to send to ${recipient.email} - ${err.message}`);
        store.updateJob(jobId, (j) => {
          const r = j.recipients.find((x) => x.email === recipient.email);
          r.status = 'failed';
          r.error = err.message;
        });
      }
    }

    const updated = store.getJob(jobId);
    if (!updated) return;
    const allDone = updated.recipients.every(isSettled);
    if (allDone) {
      const anyFailed = updated.recipients.some((r) => ['failed', 'bounced'].includes(r.status));
      const sentCount = updated.recipients.filter((r) => r.status === 'sent').length;
      store.updateJob(jobId, (j) => {
        j.status = anyFailed ? 'completed_with_errors' : 'completed';
        j.completedAt = new Date().toISOString();
      });
      logger.info(`Job ${jobId} (randomized) finished: ${sentCount} sent (bounce watcher keeps checking recent sends for a while)`);
      if (anyFailed) {
        notify(
          'Coldmail Autopilot - send errors',
          `Some emails failed for "${updated.subject}". Check logs/activity.log.`
        );
      }
    }
  } finally {
    sendingKeys.delete(key);
  }
}

function processRandomJob(job, now) {
  for (const recipient of job.recipients) {
    if (recipient.status !== 'pending') continue;
    if (!recipient.sendAt) continue;
    if (new Date(recipient.sendAt).getTime() <= now) {
      sendRandomOne(job.id, recipient.email).catch((err) => {
        logger.error(`Job ${job.id} randomized send crashed: ${err.message}`);
        notify('Coldmail Autopilot - job crashed', `${job.subject}: ${err.message}`);
      });
    }
  }
}

function tick() {
  let jobs;
  try {
    jobs = store.listJobs();
  } catch (err) {
    logger.error(`Scheduler tick failed to read jobs: ${err.message}`);
    notify('Coldmail Autopilot - scheduler error', err.message);
    return;
  }
  const now = Date.now();
  for (const job of jobs) {
    if (['completed', 'completed_with_errors', 'error'].includes(job.status)) continue;

    if (job.schedulingMode === 'random') {
      processRandomJob(job, now);
      continue;
    }

    // A job that shows 'sending' but isn't actually running was interrupted
    // by a server restart mid-send - pick it up where it left off (already
    // sent recipients are skipped inside runJob).
    if (job.status === 'sending' && !running.has(job.id)) {
      logger.info(`Job ${job.id}: was mid-send when the server restarted, resuming`);
      store.updateJob(job.id, (j) => {
        j.status = 'pending';
      });
      job.status = 'pending';
    }

    // A job paused for hitting the daily cap resumes as soon as we're back
    // under the limit (e.g. the next day).
    if (job.status === 'paused_daily_limit') {
      if (dailyCapReached()) continue;
      logger.info(`Job ${job.id}: daily cap has reset, resuming paused job`);
      store.updateJob(job.id, (j) => {
        j.status = 'pending';
      });
      job.status = 'pending';
    }

    if (job.status !== 'pending') continue;
    const dueTime = job.scheduleAt ? new Date(job.scheduleAt).getTime() : now;
    if (dueTime <= now) {
      if (job.scheduleAt) {
        logger.info(`Job ${job.id}: scheduled time ${job.scheduleAt} reached, dispatching`);
      }
      runJob(job).catch((err) => {
        logger.error(`Job ${job.id} crashed: ${err.message}`);
        notify('Coldmail Autopilot - job crashed', `${job.subject}: ${err.message}`);
      });
    }
  }
}

function start() {
  // Refuse to run a second scheduler - it would double-send every email.
  const lock = acquireSchedulerLock();
  if (!lock.ok) {
    logger.error(
      `Another Coldmail instance (pid ${lock.heldBy}) is already running the scheduler. ` +
        `This process will NOT send anything, to avoid duplicate emails. ` +
        `Stop the extra copy (a stray 'npm run dev' / 'npm start' alongside the background service ` +
        `is the usual cause), then restart. Lock file: ${LOCK_PATH}`
    );
    notify(
      'Coldmail Autopilot - duplicate instance blocked',
      'Another copy is already running. This one will not send, to avoid duplicate emails.'
    );
    return;
  }
  // Release the lock on shutdown so the next start (e.g. LaunchAgent restart)
  // can take over cleanly instead of seeing a stale lock.
  const release = () => releaseSchedulerLock();
  process.on('exit', release);
  process.on('SIGINT', () => { release(); process.exit(0); });
  process.on('SIGTERM', () => { release(); process.exit(0); });

  const w = warmupStatus();
  logger.info(
    `Scheduler started (pid ${process.pid}; poll every ${POLL_INTERVAL_MS / 1000}s; pacing: >=4 min between sends, ` +
      `max 5 per 20 min across all jobs; sending hours ${sendHours.describe()}; ` +
      `daily cap ${w.limit || 'off'}` +
      (w.active ? ` [warm-up week ${w.week}, ramping to ${w.fullLimit} - new senders must build reputation gradually]` : '') +
      `)`
  );
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
  bounceWatcher.start();
}

module.exports = { start, runJob, getDailySendStatus };
