const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    return { jobs: [], templates: [], sentEmails: {} };
  }
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!Array.isArray(data.jobs)) data.jobs = [];
    if (!Array.isArray(data.templates)) data.templates = [];
    if (!data.sentEmails || typeof data.sentEmails !== 'object') data.sentEmails = {};
    return data;
  } catch {
    return { jobs: [], templates: [], sentEmails: {} };
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function listJobs() {
  return load().jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getJob(id) {
  return load().jobs.find((j) => j.id === id);
}

function addJob(job) {
  const data = load();
  data.jobs.push(job);
  save(data);
  return job;
}

function updateJob(id, updater) {
  const data = load();
  const job = data.jobs.find((j) => j.id === id);
  if (!job) return null;
  updater(job);
  save(data);
  return job;
}

function deleteJob(id) {
  const data = load();
  data.jobs = data.jobs.filter((j) => j.id !== id);
  save(data);
}

// Jobs are hidden ("archived"), never deleted, once finished: the daily-cap
// counter, the send-pacing gate and the bounce watcher all scan every job's
// recipients, so removing a recently-completed job would undercount today's
// sends (risking going over the provider limit) and lose in-flight bounces.
// Archiving just sets a flag the UI filters on; the data stays intact.
const TERMINAL_STATUSES = ['completed', 'completed_with_errors', 'error'];

function setJobArchived(id, archived) {
  return updateJob(id, (j) => {
    j.archived = Boolean(archived);
  });
}

// Archive every finished job at once. Returns how many were newly archived.
function archiveFinishedJobs() {
  const data = load();
  let count = 0;
  for (const j of data.jobs) {
    if (TERMINAL_STATUSES.includes(j.status) && !j.archived) {
      j.archived = true;
      count++;
    }
  }
  if (count > 0) save(data);
  return count;
}

function listTemplates() {
  return load().templates.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function getTemplate(id) {
  return load().templates.find((t) => t.id === id);
}

function addTemplate(template) {
  const data = load();
  data.templates.push(template);
  save(data);
  return template;
}

function updateTemplate(id, updater) {
  const data = load();
  const template = data.templates.find((t) => t.id === id);
  if (!template) return null;
  updater(template);
  save(data);
  return template;
}

function deleteTemplate(id) {
  const data = load();
  data.templates = data.templates.filter((t) => t.id !== id);
  save(data);
}

// Registry of every unique address a send has actually succeeded to, so you
// can tell at a glance who's already been contacted across all campaigns.
function recordSentEmail({ email, company, subject }) {
  const data = load();
  const key = email.toLowerCase();
  const now = new Date().toISOString();
  // Durable marker of the very first send ever, used by the warm-up ramp to
  // know how "old" this sending account's cold-email activity is. Kept
  // separately because jobs and sent-email rows can be deleted later.
  if (!data.firstSendAt) data.firstSendAt = now;
  const existing = data.sentEmails[key];
  if (existing) {
    existing.lastSentAt = now;
    existing.timesSent += 1;
    if (company && !existing.company) existing.company = company;
    if (subject && !existing.subjects.includes(subject)) existing.subjects.push(subject);
  } else {
    data.sentEmails[key] = {
      email,
      company: company || '',
      firstSentAt: now,
      lastSentAt: now,
      timesSent: 1,
      subjects: subject ? [subject] : [],
    };
  }
  save(data);
}

// A bounce means the send never actually reached anyone - take it back out of
// the "successfully contacted" sheet so its numbers stay honest.
function removeSentEmail(email) {
  const data = load();
  const key = email.toLowerCase();
  if (data.sentEmails[key]) {
    delete data.sentEmails[key];
    save(data);
  }
}

function listSentEmails() {
  return Object.values(load().sentEmails).sort((a, b) => b.lastSentAt.localeCompare(a.lastSentAt));
}

// How many emails have actually gone out so far today (UTC), across every job.
// Used to stay under the account's daily sending limit. sentAt is stored as an
// ISO/UTC string, so we compare against the UTC date - close enough to Gmail's
// rolling 24h quota for a safety cap.
function countSentToday() {
  const today = new Date().toISOString().slice(0, 10);
  let count = 0;
  for (const job of load().jobs) {
    for (const r of job.recipients || []) {
      if (r.status === 'sent' && typeof r.sentAt === 'string' && r.sentAt.slice(0, 10) === today) {
        count++;
      }
    }
  }
  return count;
}

function hasSentTo(email) {
  return Boolean(load().sentEmails[email.toLowerCase()]);
}

// When the very first email was ever sent through this app (null if never).
function firstSendAt() {
  const t = load().firstSendAt;
  return typeof t === 'string' ? new Date(t) : null;
}

module.exports = {
  listJobs,
  getJob,
  addJob,
  updateJob,
  deleteJob,
  setJobArchived,
  archiveFinishedJobs,
  TERMINAL_STATUSES,
  listTemplates,
  getTemplate,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  recordSentEmail,
  removeSentEmail,
  listSentEmails,
  hasSentTo,
  countSentToday,
  firstSendAt,
};
