const store = require('./store');
const { getTransporter, sendOne } = require('./mailer');
const logger = require('./logger');
const { notify } = require('./notify');

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

function dailyCapReached() {
  const limit = dailyLimit();
  return limit > 0 && store.countSentToday() >= limit;
}

function getDailySendStatus() {
  const limit = dailyLimit();
  const sentToday = store.countSentToday();
  return {
    sentToday,
    dailyLimit: limit,
    remaining: limit > 0 ? Math.max(0, limit - sentToday) : null,
    capEnabled: limit > 0,
  };
}

// Real people don't send on a perfectly regular metronome. Jitter the gap
// between sends (±40%) so the cadence looks less automated.
function nextSendDelay() {
  const base = Number(process.env.SEND_DELAY_MS || 4000);
  const jitter = base * 0.4;
  return Math.max(1000, Math.round(base - jitter + Math.random() * (2 * jitter)));
}

async function runJob(job) {
  if (running.has(job.id)) return;
  if (dailyCapReached()) {
    // Hold the job until the cap clears rather than blowing past the limit.
    store.updateJob(job.id, (j) => {
      if (j.status === 'pending') j.status = 'paused_daily_limit';
    });
    return;
  }
  running.add(job.id);

  logger.info(`Job ${job.id} ("${job.subject}") starting, ${job.recipients.length} recipient(s)`);
  store.updateJob(job.id, (j) => {
    j.status = 'sending';
  });

  let transporter;
  try {
    transporter = getTransporter();
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

  for (const recipient of job.recipients) {
    if (recipient.status === 'sent') continue;
    if (dailyCapReached()) {
      logger.info(`Job ${job.id}: daily send cap (${dailyLimit()}) reached, pausing remaining recipients until it resets`);
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
    try {
      await sendOne(transporter, {
        to: recipient.email,
        subject: job.subject,
        body: job.body,
        company: recipient.company || '',
        attachment: job.attachment,
      });
      logger.info(`Job ${job.id}: sent to ${recipient.email}`);
      store.updateJob(job.id, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'sent';
        r.sentAt = new Date().toISOString();
      });
      store.recordSentEmail({ email: recipient.email, company: recipient.company, subject: job.subject });
    } catch (err) {
      logger.error(`Job ${job.id}: failed to send to ${recipient.email} - ${err.message}`);
      store.updateJob(job.id, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'failed';
        r.error = err.message;
      });
    }
    await new Promise((resolve) => setTimeout(resolve, nextSendDelay()));
  }

  const failedCount = job.recipients.filter((r) => r.status === 'failed').length;
  store.updateJob(job.id, (j) => {
    const anyFailed = j.recipients.some((r) => r.status === 'failed');
    j.status = anyFailed ? 'completed_with_errors' : 'completed';
    j.completedAt = new Date().toISOString();
  });
  logger.info(`Job ${job.id} finished: ${failedCount} failed`);
  if (failedCount > 0) {
    notify(
      'Coldmail Autopilot - send errors',
      `${failedCount} of ${job.recipients.length} email(s) failed for "${job.subject}". Check logs/activity.log.`
    );
  }
  running.delete(job.id);
}

// Randomized jobs don't run as one atomic batch - each recipient has its own
// sendAt spread across the window, so they're dispatched independently as
// each one comes due.
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
    if (dailyCapReached()) return;

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

    try {
      await sendOne(transporter, {
        to: recipient.email,
        subject: job.subject,
        body: job.body,
        company: recipient.company || '',
        attachment: job.attachment,
      });
      logger.info(`Job ${jobId}: sent to ${recipient.email} (randomized slot)`);
      store.updateJob(jobId, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'sent';
        r.sentAt = new Date().toISOString();
      });
      store.recordSentEmail({ email: recipient.email, company: recipient.company, subject: job.subject });
    } catch (err) {
      logger.error(`Job ${jobId}: failed to send to ${recipient.email} - ${err.message}`);
      store.updateJob(jobId, (j) => {
        const r = j.recipients.find((x) => x.email === recipient.email);
        r.status = 'failed';
        r.error = err.message;
      });
    }

    const updated = store.getJob(jobId);
    const allDone = updated.recipients.every((r) => r.status === 'sent' || r.status === 'failed');
    if (allDone) {
      const anyFailed = updated.recipients.some((r) => r.status === 'failed');
      store.updateJob(jobId, (j) => {
        j.status = anyFailed ? 'completed_with_errors' : 'completed';
        j.completedAt = new Date().toISOString();
      });
      logger.info(`Job ${jobId} (randomized) finished`);
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

    // A job paused for hitting the daily cap resumes as soon as we're back
    // under the limit (e.g. the next day).
    if (job.status === 'paused_daily_limit') {
      if (dailyCapReached()) continue;
      store.updateJob(job.id, (j) => {
        j.status = 'pending';
      });
      job.status = 'pending';
    }

    if (job.status !== 'pending') continue;
    const dueTime = job.scheduleAt ? new Date(job.scheduleAt).getTime() : now;
    if (dueTime <= now) {
      runJob(job).catch((err) => {
        logger.error(`Job ${job.id} crashed: ${err.message}`);
        notify('Coldmail Autopilot - job crashed', `${job.subject}: ${err.message}`);
      });
    }
  }
}

function start() {
  logger.info('Scheduler started');
  tick();
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { start, runJob, getDailySendStatus };
