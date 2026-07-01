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

module.exports = {
  listJobs,
  getJob,
  addJob,
  updateJob,
  deleteJob,
  listTemplates,
  getTemplate,
  addTemplate,
  updateTemplate,
  deleteTemplate,
  recordSentEmail,
  listSentEmails,
  hasSentTo,
  countSentToday,
};
