const { ImapFlow } = require('imapflow');

const store = require('./store');
const logger = require('./logger');
const { notify } = require('./notify');
const { recordVerifyResult } = require('./verifyCache');

// Makes bounces useful instead of silent failures. Guessed addresses
// (hr@, careers@, jobs@, ...) can't be pre-verified on networks that block
// port 25, so the cold email itself is the test:
//
//   1. Jobs created in "fallback mode" only email the FIRST candidate per
//      company; the rest sit in the job with status 'fallback'.
//   2. After each send, this watcher polls the sending account's own inbox
//      over IMAP for bounce reports (mailer-daemon / postmaster).
//   3. When a sent address bounces, it's marked 'bounced', removed from the
//      sent-emails sheet, cached as invalid for 30 days, and the next
//      fallback candidate for that company is promoted to 'pending' - the
//      scheduler then sends it under the normal pacing rules.
//
// This needs IMAP enabled on the Gmail account (Settings -> Forwarding and
// POP/IMAP -> Enable IMAP). The same app password works for IMAP.

const POLL_INTERVAL_MS = 60 * 1000;
// How long after a send we keep watching for its bounce. Most arrive within
// a minute or two; a few stragglers take longer.
const WATCH_WINDOW_MS = Number(process.env.BOUNCE_WATCH_MS || 45 * 60 * 1000);

let polling = false;
let lastImapErrorAt = 0;

// Recipients we sent to recently enough that a bounce may still show up.
function watchedRecipients() {
  const cutoff = Date.now() - WATCH_WINDOW_MS;
  const watched = [];
  for (const job of store.listJobs()) {
    for (const r of job.recipients || []) {
      if (r.status === 'sent' && typeof r.sentAt === 'string') {
        const t = new Date(r.sentAt).getTime();
        if (Number.isFinite(t) && t > cutoff) {
          watched.push({ jobId: job.id, email: r.email.toLowerCase(), sentAt: t });
        }
      }
    }
  }
  return watched;
}

// Marks a recipient as bounced and promotes the next fallback candidate for
// the same company (if the job has one). Also used by the scheduler when a
// send is rejected synchronously with a 5xx.
function handleBounce(jobId, email, reason) {
  const key = email.toLowerCase();
  let promoted = null;
  let changed = false;
  const job = store.updateJob(jobId, (j) => {
    const r = j.recipients.find((x) => x.email.toLowerCase() === key);
    if (!r || r.status === 'bounced') return; // already handled (e.g. two bounce reports)
    changed = true;
    r.status = 'bounced';
    r.error = reason;
    r.bouncedAt = new Date().toISOString();

    const company = (r.company || '').trim().toLowerCase();
    if (company) {
      const next = j.recipients.find(
        (x) => x.status === 'fallback' && (x.company || '').trim().toLowerCase() === company
      );
      if (next) {
        next.status = 'pending';
        if (j.schedulingMode === 'random') next.sendAt = new Date().toISOString();
        promoted = next.email;
      }
    }

    // Reopen the job if it had already been marked finished - the scheduler
    // only looks at unfinished jobs.
    if (promoted && ['completed', 'completed_with_errors'].includes(j.status)) {
      j.status = 'pending';
    } else if (!promoted && j.status === 'completed') {
      j.status = 'completed_with_errors';
    }
  });
  if (!job || !changed) return;

  store.removeSentEmail(key);
  recordVerifyResult(key, 'invalid');

  logger.info(
    `Bounce: ${email} bounced (${reason})` +
      (promoted
        ? ` - promoting fallback candidate ${promoted} for the same company, it will send under normal pacing`
        : ' - no fallback candidate left for this company')
  );
  notify(
    'Coldmail Autopilot - bounce',
    promoted
      ? `${email} bounced; trying ${promoted} instead.`
      : `${email} bounced and no fallback address is left for that company.`
  );
}

// Scans the sending account's inbox for bounce reports that mention any of
// the watched addresses.
async function checkForBounces() {
  const watched = watchedRecipients();
  if (watched.length === 0) return;

  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return;

  const oldest = new Date(Math.min(...watched.map((w) => w.sentAt)) - 60 * 1000);
  logger.info(`Bounce watch: checking ${user}'s inbox for bounces of ${watched.length} recent send(s)`);

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const uids = await client.search(
        { since: oldest, or: [{ from: 'mailer-daemon' }, { from: 'postmaster' }] },
        { uid: true }
      );
      if (!uids || uids.length === 0) return;
      logger.info(`Bounce watch: found ${uids.length} bounce report(s), matching against recent sends`);
      for (const uid of uids) {
        const msg = await client.fetchOne(uid, { source: true }, { uid: true });
        if (!msg || !msg.source) continue;
        const text = msg.source.toString('utf8').toLowerCase();
        for (const w of watched) {
          if (text.includes(w.email)) {
            handleBounce(w.jobId, w.email, 'bounce report received (address rejected by receiving server)');
          }
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}

function tick() {
  if (polling) return;
  polling = true;
  checkForBounces()
    .catch((err) => {
      // Don't spam the log every minute if IMAP is disabled/misconfigured.
      if (Date.now() - lastImapErrorAt > 10 * 60 * 1000) {
        lastImapErrorAt = Date.now();
        logger.error(
          `Bounce watch: could not check inbox over IMAP: ${err.message}. ` +
            `Bounce-based fallback retries won't work until this is fixed ` +
            `(is IMAP enabled on ${process.env.GMAIL_USER}? Gmail Settings -> Forwarding and POP/IMAP).`
        );
      }
    })
    .finally(() => {
      polling = false;
    });
}

function start() {
  logger.info(
    `Bounce watcher started (polls the inbox every ${POLL_INTERVAL_MS / 1000}s while there are ` +
      `sends newer than ${Math.round(WATCH_WINDOW_MS / 60000)} min; bounced addresses trigger the next fallback candidate)`
  );
  setInterval(tick, POLL_INTERVAL_MS);
}

module.exports = { start, handleBounce };
