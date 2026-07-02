require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');

const store = require('./lib/store');
const { guessMany } = require('./lib/emailGuesser');
const { spamCheck } = require('./lib/spamCheck');
const scheduler = require('./lib/scheduler');
const logger = require('./lib/logger');
const randomScheduler = require('./lib/randomScheduler');
const sendHours = require('./lib/sendHours');

const app = express();
const PORT = process.env.PORT || 3000;

// Label of the macOS LaunchAgent that runs this app in the background, used
// only to make the "port already in use" hint below point at the right plist.
// Override it in .env to match whatever you named your plist.
const LAUNCH_AGENT_LABEL = process.env.LAUNCH_AGENT_LABEL || 'com.yourname.coldmailautopilot';

const upload = multer({ dest: path.join(__dirname, 'uploads') });

// Jobs copy the template's attachment reference at creation time, so don't
// delete a file an unfinished job still depends on for sending.
function isAttachmentInUseByUnfinishedJob(attachmentPath) {
  return store
    .listJobs()
    .some(
      (j) =>
        !['completed', 'completed_with_errors', 'error'].includes(j.status) &&
        j.attachment &&
        j.attachment.path === attachmentPath
    );
}

function deleteAttachmentFile(attachment) {
  if (!attachment || !attachment.path) return;
  if (isAttachmentInUseByUnfinishedJob(attachment.path)) return;
  fs.unlink(attachment.path, (err) => {
    if (err && err.code !== 'ENOENT') {
      logger.error(`Failed to delete attachment file ${attachment.path}: ${err.message}`);
    }
  });
}

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Guess candidate emails for a list of company names
app.post('/api/guess-emails', async (req, res) => {
  try {
    const { companies } = req.body;
    if (!Array.isArray(companies) || companies.length === 0) {
      return res.status(400).json({ error: 'companies must be a non-empty array' });
    }
    const results = await guessMany(companies);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Advisory content linter: flags spam-trigger patterns in a subject/body so
// they can be rephrased before sending. Never blocks anything.
app.post('/api/spam-check', (req, res) => {
  const { subject = '', body = '', recipientCount = 0 } = req.body || {};
  res.json({ warnings: spamCheck({ subject, body, recipientCount: Number(recipientCount) || 0 }) });
});

// How many emails have gone out today vs. the configured daily cap, so the UI
// can warn before you push the account past its sending limit.
app.get('/api/send-status', (req, res) => {
  res.json({ ...scheduler.getDailySendStatus(), sendHours: sendHours.describe() });
});

// Check whether N recipients fit in a randomized time window before committing to it
app.post('/api/check-capacity', (req, res) => {
  try {
    const { count, windowStart, windowEnd } = req.body;
    const n = Number(count);
    const start = new Date(windowStart);
    const end = new Date(windowEnd);
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ error: 'count must be a positive number' });
    }
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      return res.status(400).json({ error: 'windowStart must be before windowEnd' });
    }
    const result = randomScheduler.checkCapacity(n, end.getTime() - start.getTime());
    res.json({
      feasible: result.feasible,
      maxCapacity: result.maxCapacity,
      requiredMinutes: Math.ceil(result.requiredMs / 60000),
      windowMinutes: Math.floor((end.getTime() - start.getTime()) / 60000),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Templates: named subject/body/attachment bundles, reused across jobs ---

app.get('/api/templates', (req, res) => {
  res.json({ templates: store.listTemplates() });
});

app.get('/api/templates/:id', (req, res) => {
  const template = store.getTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'not found' });
  res.json({ template });
});

app.post('/api/templates', upload.single('attachment'), (req, res) => {
  try {
    const { name, subject, body } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject and body are required' });
    }
    const template = {
      id: crypto.randomUUID(),
      name,
      subject,
      body,
      attachment: req.file
        ? { path: req.file.path, originalName: req.file.originalname }
        : null,
      createdAt: new Date().toISOString(),
    };
    store.addTemplate(template);
    logger.info(`Template ${template.id} created ("${template.name}")`);
    res.json({ template });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update a template. Uploading a new attachment replaces the old one; omit it to keep the existing attachment.
app.put('/api/templates/:id', upload.single('attachment'), (req, res) => {
  try {
    const existing = store.getTemplate(req.params.id);
    if (!existing) return res.status(404).json({ error: 'not found' });
    const { name, subject, body, removeAttachment } = req.body;
    if (!name || !subject || !body) {
      return res.status(400).json({ error: 'name, subject and body are required' });
    }
    const oldAttachment = existing.attachment;
    const updated = store.updateTemplate(req.params.id, (t) => {
      t.name = name;
      t.subject = subject;
      t.body = body;
      if (req.file) {
        t.attachment = { path: req.file.path, originalName: req.file.originalname };
      } else if (removeAttachment === 'true') {
        t.attachment = null;
      }
    });
    if (req.file || removeAttachment === 'true') {
      deleteAttachmentFile(oldAttachment);
    }
    logger.info(`Template ${updated.id} updated ("${updated.name}")`);
    res.json({ template: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/templates/:id', (req, res) => {
  const template = store.getTemplate(req.params.id);
  if (!template) return res.status(404).json({ error: 'not found' });
  store.deleteTemplate(req.params.id);
  deleteAttachmentFile(template.attachment);
  logger.info(`Template ${template.id} deleted ("${template.name}")`);
  res.json({ ok: true });
});

// --- Sent-emails sheet: every unique address a send has actually succeeded to ---

app.get('/api/sent-emails', (req, res) => {
  res.json({ sentEmails: store.listSentEmails() });
});

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

app.get('/api/sent-emails/export', (req, res) => {
  const rows = store.listSentEmails();
  const header = ['email', 'company', 'timesSent', 'firstSentAt', 'lastSentAt', 'subjects'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [r.email, r.company, r.timesSent, r.firstSentAt, r.lastSentAt, r.subjects.join(' | ')]
        .map(csvEscape)
        .join(',')
    );
  }
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="sent-emails-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  res.json({ jobs: store.listJobs() });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  res.json({ job });
});

// Create a new job (send now or scheduled) from a saved template
app.post('/api/jobs', (req, res) => {
  try {
    const { templateId, recipients, scheduleAt, schedulingMode, windowStart, windowEnd, fallbackMode } = req.body;
    if (!templateId) {
      return res.status(400).json({ error: 'templateId is required - pick a template to send' });
    }
    const template = store.getTemplate(templateId);
    if (!template) {
      return res.status(404).json({ error: 'template not found' });
    }
    let recipientList = recipients;
    if (typeof recipientList === 'string') {
      try {
        recipientList = JSON.parse(recipientList);
      } catch {
        return res.status(400).json({ error: 'recipients must be a JSON array' });
      }
    }
    if (!Array.isArray(recipientList) || recipientList.length === 0) {
      return res.status(400).json({ error: 'recipients must be a non-empty array' });
    }

    const seenEmails = new Set();
    const baseRecipients = [];
    for (const r of recipientList) {
      const email = typeof r === 'string' ? r : r.email;
      const key = String(email).toLowerCase();
      if (seenEmails.has(key)) continue;
      seenEmails.add(key);
      baseRecipients.push({
        email,
        company: typeof r === 'string' ? '' : r.company || '',
        status: 'pending',
      });
    }

    const mode = schedulingMode === 'random' ? 'random' : scheduleAt ? 'fixed' : 'now';

    // Fallback mode (default on): only the FIRST address per company is
    // actually emailed; the rest are held as status 'fallback' and only get
    // promoted to 'pending' if an earlier candidate for that company bounces
    // (see lib/bounceWatcher.js). Recipients with no company can't be grouped
    // and are all sent. Pass fallbackMode: false to email every address.
    const useFallbacks = fallbackMode !== false && fallbackMode !== 'false';
    if (useFallbacks) {
      const seenCompanies = new Set();
      for (const r of baseRecipients) {
        const company = (r.company || '').trim().toLowerCase();
        if (!company) continue;
        if (seenCompanies.has(company)) r.status = 'fallback';
        else seenCompanies.add(company);
      }
    }
    const activeRecipients = baseRecipients.filter((r) => r.status === 'pending');
    const fallbackCount = baseRecipients.length - activeRecipients.length;

    let jobRecipients = baseRecipients;
    let jobScheduleAt = scheduleAt || null;
    let jobWindow = null;

    if (mode === 'random') {
      const start = new Date(windowStart);
      const end = new Date(windowEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
        return res.status(400).json({ error: 'windowStart must be before windowEnd' });
      }
      // A window entirely outside the allowed sending hours would have every
      // "randomized" time silently held until the next workday morning by the
      // send gate - the schedule the user picked would be fiction. Reject it
      // up front instead so they can pick a window inside business hours
      // (sends timed like a human's are far less likely to be flagged).
      let anyAllowed = false;
      for (let t = start.getTime(); t <= end.getTime(); t += 15 * 60 * 1000) {
        if (sendHours.isAllowed(new Date(t))) {
          anyAllowed = true;
          break;
        }
      }
      if (!anyAllowed) {
        return res.status(400).json({
          error:
            `This window falls entirely outside the allowed sending hours (${sendHours.describe()}). ` +
            `Emails sent at night or on weekends look automated to spam filters (and go unread), ` +
            `so pick a window inside those hours - or change SEND_HOURS_START/END in .env.`,
        });
      }
      let times;
      try {
        // Only the active recipients need slots in the window; a promoted
        // fallback gets sendAt = now at promotion time.
        times = randomScheduler.generateRandomTimes(activeRecipients.length, start, end);
      } catch (err) {
        if (err.code === 'CAPACITY_EXCEEDED') {
          return res.status(400).json({
            error: err.message,
            code: 'CAPACITY_EXCEEDED',
            maxCapacity: err.maxCapacity,
          });
        }
        throw err;
      }
      let slot = 0;
      jobRecipients = baseRecipients.map((r) =>
        r.status === 'pending' ? { ...r, sendAt: times[slot++].toISOString() } : { ...r }
      );
      jobScheduleAt = null;
      jobWindow = { start: start.toISOString(), end: end.toISOString() };
    }

    const job = {
      id: crypto.randomUUID(),
      templateId: template.id,
      templateName: template.name,
      subject: template.subject,
      body: template.body,
      schedulingMode: mode,
      scheduleAt: jobScheduleAt,
      window: jobWindow,
      status: 'pending',
      createdAt: new Date().toISOString(),
      attachment: template.attachment,
      recipients: jobRecipients,
    };

    store.addJob(job);
    logger.info(
      `Job ${job.id} created from template "${template.name}" ("${job.subject}"): ` +
        `${activeRecipients.length} recipient(s) to email` +
        (fallbackCount > 0 ? ` + ${fallbackCount} held as bounce fallback(s)` : '') +
        `, mode=${mode}` +
        (mode === 'fixed' ? ` scheduled for ${jobScheduleAt}` : '') +
        (mode === 'random' ? ` window ${jobWindow.start} - ${jobWindow.end}` : '')
    );
    res.json({ job });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Cancel a job that hasn't finished. With the enforced 4-minute spacing a job
// can be mid-send for a long time, so 'sending' jobs are cancellable too -
// the scheduler checks the store before every send and stops if the job is
// gone (already-sent emails obviously can't be recalled).
app.delete('/api/jobs/:id', (req, res) => {
  const job = store.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'not found' });
  if (!['pending', 'paused_daily_limit', 'sending'].includes(job.status)) {
    return res.status(400).json({ error: 'only pending, paused or in-progress jobs can be cancelled' });
  }
  store.deleteJob(req.params.id);
  const sentSoFar = job.recipients.filter((r) => r.status === 'sent').length;
  logger.info(`Job ${job.id} cancelled by user (status was ${job.status}, ${sentSoFar}/${job.recipients.length} already sent)`);
  res.json({ ok: true });
});

const httpServer = app.listen(PORT, () => {
  console.log(`Coldmail Autopilot running at http://localhost:${PORT}`);
  scheduler.start();
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use - the background service (LaunchAgent ` +
        `${LAUNCH_AGENT_LABEL}) is likely already running the app.\n` +
        `Just open http://localhost:${PORT} - you don't need to start it manually.\n` +
        `To stop the background service: launchctl unload ~/Library/LaunchAgents/${LAUNCH_AGENT_LABEL}.plist\n`
    );
    process.exit(1);
  }
  throw err;
});
