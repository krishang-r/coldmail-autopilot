// --- Dark / light theme toggle ---
const themeToggleBtn = document.getElementById('themeToggleBtn');

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
  applyPalette(getStoredPalette());
}

const storedTheme = localStorage.getItem('theme');
const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

themeToggleBtn.addEventListener('click', () => {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem('theme', next);
  applyTheme(next);
});

// --- Color theme / accent palette picker ---
const PALETTES = {
  teal: { label: 'Teal', light: { accent: '#0d7d6f', accentDark: '#095e53' }, dark: { accent: '#2bb3a3', accentDark: '#1f8a7d' } },
  indigo: { label: 'Indigo', light: { accent: '#4338ca', accentDark: '#332e93' }, dark: { accent: '#818cf8', accentDark: '#6366f1' } },
  amber: { label: 'Amber', light: { accent: '#b45309', accentDark: '#92400e' }, dark: { accent: '#f5a524', accentDark: '#d97e06' } },
  rose: { label: 'Rose', light: { accent: '#be123c', accentDark: '#9f1239' }, dark: { accent: '#fb7185', accentDark: '#f43f5e' } },
  forest: { label: 'Forest', light: { accent: '#15803d', accentDark: '#14532d' }, dark: { accent: '#4ade80', accentDark: '#22c55e' } },
  slate: { label: 'Slate', light: { accent: '#334155', accentDark: '#1e293b' }, dark: { accent: '#94a3b8', accentDark: '#64748b' } },
};

const paletteToggleBtn = document.getElementById('paletteToggleBtn');
const palettePanel = document.getElementById('palettePanel');
const paletteSwatches = document.getElementById('paletteSwatches');
const customAccentInput = document.getElementById('customAccentInput');

function getStoredPalette() {
  return localStorage.getItem('palette') || 'teal';
}

function applyPalette(name) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const root = document.documentElement.style;
  if (name === 'custom') {
    const hex = localStorage.getItem('customAccent') || customAccentInput.value;
    root.setProperty('--accent', hex);
    root.setProperty('--accent-dark', `color-mix(in srgb, ${hex} 75%, black)`);
    root.setProperty('--accent-contrast', isDark ? '#06120f' : '#ffffff');
  } else {
    const palette = PALETTES[name] || PALETTES.teal;
    const vars = isDark ? palette.dark : palette.light;
    root.setProperty('--accent', vars.accent);
    root.setProperty('--accent-dark', vars.accentDark);
    root.setProperty('--accent-contrast', isDark ? '#06120f' : '#ffffff');
  }
  renderPaletteSwatches(name);
}

function renderPaletteSwatches(activeName) {
  paletteSwatches.innerHTML = '';
  for (const [key, palette] of Object.entries(PALETTES)) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const swatch = document.createElement('button');
    swatch.type = 'button';
    swatch.className = 'palette-swatch' + (activeName === key ? ' active' : '');
    swatch.style.background = isDark ? palette.dark.accent : palette.light.accent;
    swatch.title = palette.label;
    swatch.addEventListener('click', () => {
      localStorage.setItem('palette', key);
      applyPalette(key);
    });
    paletteSwatches.appendChild(swatch);
  }
}

customAccentInput.addEventListener('input', () => {
  localStorage.setItem('palette', 'custom');
  localStorage.setItem('customAccent', customAccentInput.value);
  applyPalette('custom');
});

paletteToggleBtn.addEventListener('click', () => {
  palettePanel.hidden = !palettePanel.hidden;
});
document.addEventListener('click', (e) => {
  if (!palettePanel.hidden && !e.target.closest('.palette-picker')) {
    palettePanel.hidden = true;
  }
});

const storedCustomAccent = localStorage.getItem('customAccent');
if (storedCustomAccent) customAccentInput.value = storedCustomAccent;

applyTheme(storedTheme || (systemPrefersDark ? 'dark' : 'light'));

// --- Sent-emails sheet: unique addresses actually sent to, across all jobs ---
let sentEmailsSet = new Set();

async function loadSentEmails() {
  const res = await fetch('/api/sent-emails');
  const data = await res.json();
  sentEmailsSet = new Set(data.sentEmails.map((r) => r.email.toLowerCase()));

  document.getElementById('sentEmailsSummary').textContent =
    data.sentEmails.length === 0
      ? '📇 No emails sent yet'
      : `📇 View sent emails sheet (${data.sentEmails.length} unique contacted)`;

  const container = document.getElementById('sentEmailsList');
  if (data.sentEmails.length === 0) {
    container.innerHTML = '<p class="hint">No emails sent yet.</p>';
  } else {
    const rows = data.sentEmails
      .map(
        (r) => `
        <tr>
          <td>${escapeHtml(r.email)}</td>
          <td>${escapeHtml(r.company || '-')}</td>
          <td>${r.timesSent}</td>
          <td>${new Date(r.firstSentAt).toLocaleDateString()}</td>
          <td>${new Date(r.lastSentAt).toLocaleString()}</td>
        </tr>`
      )
      .join('');
    container.innerHTML = `
      <div class="sent-emails-wrap">
        <table class="sent-emails-table">
          <thead>
            <tr><th>Email</th><th>Company</th><th>Times sent</th><th>First sent</th><th>Last sent</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }
  updateSelectedCount();
}

document.getElementById('downloadSentBtn').addEventListener('click', () => {
  window.open('/api/sent-emails/export', '_blank');
});

// --- Templates: named subject/body/attachment bundles ---
const templateSelect = document.getElementById('templateSelect');
const templatePreview = document.getElementById('templatePreview');
const templateManager = document.getElementById('templateManager');
const templateList = document.getElementById('templateList');
const templateEditId = document.getElementById('templateEditId');
const templateFormTitle = document.getElementById('templateFormTitle');
const templateNameInput = document.getElementById('templateName');
const templateSubjectInput = document.getElementById('templateSubject');
const templateBodyInput = document.getElementById('templateBody');
const templateAttachmentInput = document.getElementById('templateAttachment');
const templateCurrentAttachment = document.getElementById('templateCurrentAttachment');
const templateRemoveAttachmentLabel = document.getElementById('templateRemoveAttachmentLabel');
const templateRemoveAttachment = document.getElementById('templateRemoveAttachment');
const templateMsg = document.getElementById('templateMsg');
const templateSpamWarnings = document.getElementById('templateSpamWarnings');
const templateEditWarnings = document.getElementById('templateEditWarnings');

let templatesCache = [];

async function loadTemplates() {
  const res = await fetch('/api/templates');
  const data = await res.json();
  templatesCache = data.templates;

  const previousValue = templateSelect.value;
  templateSelect.innerHTML = '<option value="">-- Select a saved template --</option>';
  for (const t of templatesCache) {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    templateSelect.appendChild(opt);
  }
  if (templatesCache.some((t) => t.id === previousValue)) {
    templateSelect.value = previousValue;
  }
  updateTemplatePreview();
  renderTemplateList();
}

// --- Deliverability / spam-trigger warnings ---
function renderSpamWarnings(container, warnings) {
  if (!warnings || warnings.length === 0) {
    container.hidden = true;
    container.innerHTML = '';
    return;
  }
  container.hidden = false;
  container.innerHTML =
    '<p class="spam-warnings-title">⚠ These may push the email toward spam:</p><ul>' +
    warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('') +
    '</ul>';
}

async function checkSpam({ subject, body, recipientCount }) {
  try {
    const res = await fetch('/api/spam-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, body, recipientCount: recipientCount || 0 }),
    });
    const data = await res.json();
    return data.warnings || [];
  } catch {
    return [];
  }
}

function updateTemplatePreview() {
  const t = templatesCache.find((x) => x.id === templateSelect.value);
  if (!t) {
    templatePreview.innerHTML = '';
    renderSpamWarnings(templateSpamWarnings, []);
    return;
  }
  templatePreview.innerHTML = `
    <div class="preview-subject"><strong>Subject:</strong> ${escapeHtml(t.subject)}</div>
    <div class="preview-body">${escapeHtml(t.body)}</div>
    ${t.attachment ? `<div class="hint">Attachment: ${escapeHtml(t.attachment.originalName)}</div>` : ''}
  `;
  checkSpam({ subject: t.subject, body: t.body, recipientCount: getAllRecipients().length }).then((w) =>
    renderSpamWarnings(templateSpamWarnings, w)
  );
}
templateSelect.addEventListener('change', updateTemplatePreview);

// Re-lint the selected template's preview when the recipient count changes
// (the "not personalized to a big list" warning depends on it). Debounced so
// typing in the recipients box doesn't spam requests.
let previewSpamTimer;
function refreshPreviewSpam() {
  const t = templatesCache.find((x) => x.id === templateSelect.value);
  if (!t) return;
  clearTimeout(previewSpamTimer);
  previewSpamTimer = setTimeout(async () => {
    const w = await checkSpam({ subject: t.subject, body: t.body, recipientCount: getAllRecipients().length });
    renderSpamWarnings(templateSpamWarnings, w);
  }, 400);
}

// Live-lint the template being written/edited (debounced).
let editSpamTimer;
function scheduleEditSpamCheck() {
  clearTimeout(editSpamTimer);
  editSpamTimer = setTimeout(async () => {
    const subject = templateSubjectInput.value;
    const body = templateBodyInput.value;
    if (!subject && !body) {
      renderSpamWarnings(templateEditWarnings, []);
      return;
    }
    renderSpamWarnings(templateEditWarnings, await checkSpam({ subject, body }));
  }, 500);
}
templateSubjectInput.addEventListener('input', scheduleEditSpamCheck);
templateBodyInput.addEventListener('input', scheduleEditSpamCheck);

function renderTemplateList() {
  templateList.innerHTML = '';
  if (templatesCache.length === 0) {
    templateList.innerHTML = '<p class="hint">No templates yet - create one below.</p>';
    return;
  }
  for (const t of templatesCache) {
    const row = document.createElement('div');
    row.className = 'template-row';
    row.innerHTML = `
      <div>
        <strong>${escapeHtml(t.name)}</strong>
        <div class="hint">${escapeHtml(t.subject)}${t.attachment ? ' · 📎 ' + escapeHtml(t.attachment.originalName) : ''}</div>
      </div>
      <div>
        <button class="edit-template-btn" data-id="${t.id}" type="button">Edit</button>
        <button class="delete-template-btn" data-id="${t.id}" type="button">Delete</button>
      </div>
    `;
    templateList.appendChild(row);
  }
  templateList.querySelectorAll('.edit-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => startEditTemplate(btn.dataset.id));
  });
  templateList.querySelectorAll('.delete-template-btn').forEach((btn) => {
    btn.addEventListener('click', () => deleteTemplate(btn.dataset.id));
  });
}

function startEditTemplate(id) {
  const t = templatesCache.find((x) => x.id === id);
  if (!t) return;
  templateEditId.value = t.id;
  templateFormTitle.textContent = `Edit template: ${t.name}`;
  templateNameInput.value = t.name;
  templateSubjectInput.value = t.subject;
  templateBodyInput.value = t.body;
  templateCurrentAttachment.textContent = t.attachment
    ? `Current attachment: ${t.attachment.originalName} (upload a new file to replace it)`
    : '';
  templateAttachmentInput.value = '';
  templateRemoveAttachment.checked = false;
  templateRemoveAttachmentLabel.hidden = !t.attachment;
  templateMsg.textContent = '';
  scheduleEditSpamCheck();
}

async function deleteTemplate(id) {
  await fetch(`/api/templates/${id}`, { method: 'DELETE' });
  if (templateEditId.value === id) resetTemplateForm();
  loadTemplates();
}

function resetTemplateForm() {
  templateEditId.value = '';
  templateFormTitle.textContent = 'New template';
  templateNameInput.value = '';
  templateSubjectInput.value = '';
  templateBodyInput.value = '';
  templateAttachmentInput.value = '';
  templateCurrentAttachment.textContent = '';
  templateRemoveAttachment.checked = false;
  templateRemoveAttachmentLabel.hidden = true;
  templateMsg.textContent = '';
  renderSpamWarnings(templateEditWarnings, []);
}

document.getElementById('manageTemplatesBtn').addEventListener('click', () => {
  templateManager.style.display = templateManager.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('cancelTemplateEditBtn').addEventListener('click', resetTemplateForm);

document.getElementById('saveTemplateBtn').addEventListener('click', async () => {
  const name = templateNameInput.value.trim();
  const subject = templateSubjectInput.value.trim();
  const body = templateBodyInput.value.trim();
  if (!name || !subject || !body) {
    templateMsg.textContent = 'Name, subject and body are required.';
    return;
  }
  const form = new FormData();
  form.append('name', name);
  form.append('subject', subject);
  form.append('body', body);
  const file = templateAttachmentInput.files[0];
  if (file) form.append('attachment', file);
  if (!file && templateRemoveAttachment.checked) form.append('removeAttachment', 'true');

  const id = templateEditId.value;
  const url = id ? `/api/templates/${id}` : '/api/templates';
  const method = id ? 'PUT' : 'POST';

  templateMsg.textContent = 'Saving...';
  try {
    const res = await fetch(url, { method, body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save template');
    templateMsg.textContent = `Saved "${data.template.name}".`;
    resetTemplateForm();
    await loadTemplates();
    templateSelect.value = data.template.id;
    updateTemplatePreview();
  } catch (err) {
    templateMsg.textContent = 'Error: ' + err.message;
  }
});

const tabBtns = document.querySelectorAll('.tab-btn');
const tabPanels = document.querySelectorAll('.tab-panel');
tabBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    tabBtns.forEach((b) => b.classList.remove('active'));
    tabPanels.forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

document.querySelectorAll('input[name="scheduleMode"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    const mode = document.querySelector('input[name="scheduleMode"]:checked').value;
    document.getElementById('scheduleAt').disabled = mode !== 'later';
    document.getElementById('windowDate').disabled = mode !== 'random';
    document.getElementById('rangeStart').disabled = mode !== 'random';
    document.getElementById('rangeEnd').disabled = mode !== 'random';
    document.getElementById('checkCapacityBtn').disabled = mode !== 'random';
    if (mode !== 'random') document.getElementById('capacityMsg').textContent = '';
  });
});

// --- Dual-thumb time-of-day slider for the randomized window ---
const windowDateInput = document.getElementById('windowDate');
const rangeStart = document.getElementById('rangeStart');
const rangeEnd = document.getElementById('rangeEnd');
const rangeStartLabel = document.getElementById('rangeStartLabel');
const rangeEndLabel = document.getElementById('rangeEndLabel');
const rangeHighlight = document.getElementById('rangeHighlight');
const MIN_SLIDER_GAP = 30; // minutes, keep thumbs from overlapping

function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
windowDateInput.value = todayISODate();

function minutesToLabel(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function updateSliderUI() {
  let start = Number(rangeStart.value);
  let end = Number(rangeEnd.value);
  if (end - start < MIN_SLIDER_GAP) {
    if (document.activeElement === rangeStart) {
      start = end - MIN_SLIDER_GAP;
      rangeStart.value = start;
    } else {
      end = start + MIN_SLIDER_GAP;
      rangeEnd.value = end;
    }
  }
  rangeStartLabel.textContent = minutesToLabel(start);
  rangeEndLabel.textContent = minutesToLabel(end);
  const max = Number(rangeStart.max);
  rangeHighlight.style.left = `${(start / max) * 100}%`;
  rangeHighlight.style.width = `${((end - start) / max) * 100}%`;
}
rangeStart.addEventListener('input', updateSliderUI);
rangeEnd.addEventListener('input', updateSliderUI);
updateSliderUI();

// Combines the date picker + slider into actual Date objects for the window.
function getWindowDates() {
  const [year, month, day] = windowDateInput.value.split('-').map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0);
  const end = new Date(year, month - 1, day, 0, 0, 0, 0);
  start.setMinutes(Number(rangeStart.value));
  end.setMinutes(Number(rangeEnd.value));
  return { start, end };
}

const checkCapacityBtn = document.getElementById('checkCapacityBtn');
const capacityMsg = document.getElementById('capacityMsg');

checkCapacityBtn.addEventListener('click', async () => {
  // Fallbacks don't get a slot in the window, so capacity only needs to
  // cover the addresses that will actually be emailed up front.
  const count = getActiveRecipientCount();
  if (count === 0) {
    capacityMsg.textContent = 'Select recipients first.';
    return;
  }
  const { start, end } = getWindowDates();
  capacityMsg.textContent = 'Checking...';
  try {
    const res = await fetch('/api/check-capacity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count,
        windowStart: start.toISOString(),
        windowEnd: end.toISOString(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Check failed');
    if (data.feasible) {
      capacityMsg.textContent = `Fits: ${count} email(s) need ~${data.requiredMinutes} min, window is ${data.windowMinutes} min.`;
      capacityMsg.className = 'hint valid';
    } else {
      capacityMsg.textContent = `Doesn't fit: this window only holds ${data.maxCapacity} email(s) (needs ~${data.requiredMinutes} min for ${count}, window is only ${data.windowMinutes} min). Widen the window or reduce recipients.`;
      capacityMsg.className = 'hint invalid';
    }
  } catch (err) {
    capacityMsg.textContent = 'Error: ' + err.message;
  }
});

const guessBtn = document.getElementById('guessBtn');
const guessResults = document.getElementById('guessResults');
const fallbackModeCheckbox = document.getElementById('fallbackMode');
const fallbackSummary = document.getElementById('fallbackSummary');

guessBtn.addEventListener('click', async () => {
  const raw = document.getElementById('companies').value;
  const companies = raw.split('\n').map((s) => s.trim()).filter(Boolean);
  if (companies.length === 0) return;
  guessBtn.disabled = true;
  guessBtn.textContent = 'Checking domains...';
  try {
    const res = await fetch('/api/guess-emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companies }),
    });
    const data = await res.json();
    renderGuessResults(data.results);
  } catch (err) {
    guessResults.textContent = 'Error: ' + err.message;
  } finally {
    guessBtn.disabled = false;
    guessBtn.textContent = 'Guess emails';
  }
});

function renderGuessResults(results) {
  guessResults.innerHTML = '';
  for (const result of results) {
    const group = document.createElement('div');
    group.className = 'company-group';
    const h4 = document.createElement('h4');
    h4.textContent = result.company;
    group.appendChild(h4);

    for (const candidate of result.candidates) {
      const row = document.createElement('div');
      row.className = 'candidate-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      // Never pre-tick an address that already bounced once - re-sending to a
      // known-dead address is the fastest way to get the account flagged.
      cb.checked = candidate.domainValid && !candidate.knownInvalid;
      cb.dataset.email = candidate.email;
      cb.dataset.company = result.company;
      cb.addEventListener('change', updateSelectedCount);
      const label = document.createElement('span');
      label.textContent = candidate.email;
      label.className = candidate.domainValid && !candidate.knownInvalid ? 'valid' : 'invalid';
      row.appendChild(cb);
      row.appendChild(label);
      if (!candidate.domainValid) {
        const note = document.createElement('small');
        note.textContent = '(no mail server found for this domain)';
        row.appendChild(note);
      }
      if (candidate.knownInvalid) {
        const tag = document.createElement('span');
        tag.className = 'verify-tag verify-invalid';
        tag.textContent = '❌ bounced before — auto-unticked';
        row.appendChild(tag);
      }
      if (sentEmailsSet.has(candidate.email.toLowerCase())) {
        const tag = document.createElement('span');
        tag.className = 'already-sent-tag';
        tag.textContent = 'already contacted';
        row.appendChild(tag);
      }
      group.appendChild(row);
    }
    guessResults.appendChild(group);
  }
  updateSelectedCount();
}

const exactEmailsBox = document.getElementById('exactEmails');
exactEmailsBox.addEventListener('input', updateSelectedCount);
fallbackModeCheckbox.addEventListener('change', updateSelectedCount);

function parseExactEmails() {
  return exactEmailsBox.value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [email, company] = line.split(',').map((s) => s.trim());
      return { email, company: company || '' };
    });
}

function getCheckedCandidates() {
  return Array.from(guessResults.querySelectorAll('input[type="checkbox"]:checked')).map(
    (cb) => ({ email: cb.dataset.email, company: cb.dataset.company })
  );
}

function getAllRecipients() {
  const combined = [...getCheckedCandidates(), ...parseExactEmails()];
  const seen = new Set();
  const deduped = [];
  for (const r of combined) {
    const key = r.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(r);
  }
  return deduped;
}

// With fallback mode on, only the first address per company is actually
// emailed up front - the rest wait in reserve for a bounce.
function getActiveRecipientCount() {
  const selected = getAllRecipients();
  if (!fallbackModeCheckbox.checked) return selected.length;
  const seenCompanies = new Set();
  let active = 0;
  for (const r of selected) {
    const company = (r.company || '').trim().toLowerCase();
    if (!company) {
      active++;
      continue;
    }
    if (!seenCompanies.has(company)) {
      seenCompanies.add(company);
      active++;
    }
  }
  return active;
}

function updateFallbackSummary() {
  const total = getAllRecipients().length;
  const active = getActiveRecipientCount();
  const held = total - active;
  if (fallbackModeCheckbox.checked && held > 0) {
    fallbackSummary.textContent = `${active} will be emailed; ${held} held as bounce fallback(s) — each is only used if an earlier address for its company bounces.`;
  } else {
    fallbackSummary.textContent =
      'If the first address for a company bounces, the next candidate is emailed automatically. Uncheck to email every selected address.';
  }
}

function updateSelectedCount() {
  const selected = getAllRecipients();
  document.getElementById('selectedCount').textContent = selected.length;
  updateFallbackSummary();

  const duplicates = selected.filter((r) => sentEmailsSet.has(r.email.toLowerCase()));
  const warningEl = document.getElementById('duplicateWarning');
  if (duplicates.length > 0) {
    warningEl.textContent = `⚠ ${duplicates.length} of these have already been emailed before.`;
    warningEl.className = 'hint invalid';
  } else {
    warningEl.textContent = '';
  }
  refreshPreviewSpam();
}

const submitBtn = document.getElementById('submitBtn');
const submitMsg = document.getElementById('submitMsg');
const sendStatus = document.getElementById('sendStatus');

async function loadSendStatus() {
  try {
    const res = await fetch('/api/send-status');
    const s = await res.json();
    const hours = s.sendHours ? ` Sending hours: ${s.sendHours}.` : '';
    if (!s.capEnabled) {
      sendStatus.textContent = `${s.sentToday} sent today (no daily cap set).${hours}`;
      sendStatus.className = 'hint';
      return;
    }
    // During warm-up the cap is deliberately lower than the configured limit:
    // a sudden jump in volume is the classic compromised-account signal, so
    // the cap roughly doubles each week instead.
    const warmup = s.warmup
      ? ` Warm-up week ${s.warmup.week}: today's cap is ${s.warmup.limit}, ramping weekly to ${s.warmup.fullLimit} to build sender reputation.`
      : '';
    sendStatus.textContent = `${s.sentToday} / ${s.dailyLimit} sent today — ${s.remaining} left before the daily cap.${warmup}${hours}`;
    sendStatus.className = s.remaining <= 20 ? 'hint invalid' : 'hint';
  } catch {
    /* non-fatal */
  }
}

submitBtn.addEventListener('click', async () => {
  const templateId = templateSelect.value;
  const recipients = getAllRecipients();
  const scheduleMode = document.querySelector('input[name="scheduleMode"]:checked').value;
  const scheduleAt = scheduleMode === 'later' ? document.getElementById('scheduleAt').value : '';
  const window = scheduleMode === 'random' ? getWindowDates() : null;

  if (!templateId) {
    submitMsg.textContent = 'Pick which template to send.';
    return;
  }
  if (recipients.length === 0) {
    submitMsg.textContent = 'Select at least one recipient.';
    return;
  }
  if (scheduleMode === 'later' && !scheduleAt) {
    submitMsg.textContent = 'Pick a date/time to schedule for.';
    return;
  }

  const payload = { templateId, recipients, fallbackMode: fallbackModeCheckbox.checked };
  if (scheduleMode === 'later') {
    payload.scheduleAt = new Date(scheduleAt).toISOString();
  } else if (scheduleMode === 'random') {
    payload.schedulingMode = 'random';
    payload.windowStart = window.start.toISOString();
    payload.windowEnd = window.end.toISOString();
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Creating...';
  try {
    const res = await fetch('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.code === 'CAPACITY_EXCEEDED') {
        submitMsg.textContent = `${data.error} Adjust the window or drop some recipients, then try again.`;
      } else {
        submitMsg.textContent = 'Error: ' + (data.error || 'Failed to create job');
      }
      return;
    }
    if (scheduleMode === 'later') {
      submitMsg.textContent = `Scheduled for ${new Date(scheduleAt).toLocaleString()}.`;
    } else if (scheduleMode === 'random') {
      showRandomizedResult(data.job);
    } else {
      submitMsg.textContent = 'Sending now.';
    }
    loadJobs();
    loadSendStatus();
  } catch (err) {
    submitMsg.textContent = 'Error: ' + err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Create job';
  }
});

function showRandomizedResult(job) {
  const lines = job.recipients
    .map((r) => `${r.email}${r.company ? ' (' + r.company + ')' : ''} → ${new Date(r.sendAt).toLocaleString()}`)
    .join('\n');
  submitMsg.textContent = `Randomized ${job.recipients.length} send time(s):\n${lines}`;
  submitMsg.style.whiteSpace = 'pre-line';
  renderTimeline(document.getElementById('timelinePreview'), job);
}

function renderTimeline(container, job) {
  if (!job.window) return;
  const start = new Date(job.window.start).getTime();
  const end = new Date(job.window.end).getTime();
  const span = end - start || 1;
  container.innerHTML = '';
  for (const r of job.recipients) {
    if (!r.sendAt) continue;
    const pct = ((new Date(r.sendAt).getTime() - start) / span) * 100;
    const dot = document.createElement('div');
    dot.className = 'timeline-dot' + (r.status === 'sent' ? ' sent' : r.status === 'failed' ? ' failed' : '');
    dot.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    dot.title = `${r.email} – ${new Date(r.sendAt).toLocaleTimeString()}`;
    container.appendChild(dot);
  }
}

const TERMINAL_JOB_STATUSES = ['completed', 'completed_with_errors', 'error'];
const ACTIVE_JOB_STATUSES = ['pending', 'paused_daily_limit', 'sending'];
let showDismissed = false;

async function loadJobs() {
  const res = await fetch('/api/jobs');
  const data = await res.json();
  const jobs = data.jobs || [];
  const visible = jobs.filter((j) => !j.archived);
  const dismissed = jobs.filter((j) => j.archived);
  const finishedVisible = visible.filter((j) => TERMINAL_JOB_STATUSES.includes(j.status));

  // Toolbar: "Clear finished" (only when there are finished, un-dismissed jobs)
  // and a "Show/Hide dismissed" toggle (only when some jobs are dismissed).
  const clearBtn = document.getElementById('clearFinishedBtn');
  clearBtn.hidden = finishedVisible.length === 0;
  clearBtn.textContent = `🧹 Clear finished (${finishedVisible.length})`;
  const toggleBtn = document.getElementById('toggleDismissedBtn');
  toggleBtn.hidden = dismissed.length === 0;
  toggleBtn.textContent = showDismissed ? `Hide dismissed (${dismissed.length})` : `Show dismissed (${dismissed.length})`;

  const container = document.getElementById('jobsList');
  container.innerHTML = '';

  if (visible.length === 0) {
    container.innerHTML = '<p class="hint">No active jobs. Create one above.</p>';
  }
  for (const job of visible) renderJobCard(job, container, false);
  if (showDismissed && dismissed.length > 0) {
    const heading = document.createElement('p');
    heading.className = 'hint dismissed-heading';
    heading.textContent = `Dismissed (${dismissed.length}) — hidden from the list but still counted toward the daily cap:`;
    container.appendChild(heading);
    for (const job of dismissed) renderJobCard(job, container, true);
  }

  container.querySelectorAll('.cancel-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await fetch(`/api/jobs/${btn.dataset.id}`, { method: 'DELETE' });
      loadJobs();
    })
  );
  container.querySelectorAll('.dismiss-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await fetch(`/api/jobs/${btn.dataset.id}/archive`, { method: 'POST' });
      loadJobs();
    })
  );
  container.querySelectorAll('.restore-btn').forEach((btn) =>
    btn.addEventListener('click', async () => {
      await fetch(`/api/jobs/${btn.dataset.id}/unarchive`, { method: 'POST' });
      loadJobs();
    })
  );
}

function renderJobCard(job, container, isArchived) {
  const el = document.createElement('div');
  el.className = 'job' + (isArchived ? ' job-dismissed' : '');
  const sent = job.recipients.filter((r) => r.status === 'sent').length;
  const failed = job.recipients.filter((r) => ['failed', 'bounced'].includes(r.status)).length;
  const bounced = job.recipients.filter((r) => r.status === 'bounced').length;
  const standby = job.recipients.filter((r) => r.status === 'fallback').length;

  let actionBtn = '';
  if (isArchived) {
    actionBtn = `<button class="restore-btn ghost-btn" data-id="${job.id}">Restore</button>`;
  } else if (ACTIVE_JOB_STATUSES.includes(job.status)) {
    actionBtn = `<button class="cancel-btn" data-id="${job.id}">Cancel</button>`;
  } else if (TERMINAL_JOB_STATUSES.includes(job.status)) {
    actionBtn = `<button class="dismiss-btn ghost-btn" data-id="${job.id}" title="Hide this finished job">✕ Dismiss</button>`;
  }

  el.innerHTML = `
    <div class="job-header">
      <div>
        <span class="job-light job-light-${jobLightState(job.status)}" title="${jobLightTitle(job.status)}"></span>
        <strong>${escapeHtml(job.subject)}</strong>
        ${job.templateName ? `<span class="hint">(${escapeHtml(job.templateName)})</span>` : ''}
        <span class="status-pill status-${job.status}">${job.status}</span>
      </div>
      ${actionBtn}
    </div>
    <div>${job.recipients.length} recipient(s) &mdash; ${sent} sent, ${failed} failed${bounced > 0 ? ` (${bounced} bounced)` : ''}${standby > 0 ? `, ${standby} fallback(s) in reserve` : ''}</div>
    <div>${scheduleSummary(job)}</div>
    ${job.schedulingMode === 'random' ? '<div class="timeline-preview job-timeline"></div>' : ''}
    ${job.schedulingMode === 'random' ? renderRandomRecipients(job) : ''}
  `;
  container.appendChild(el);
  if (job.schedulingMode === 'random') {
    renderTimeline(el.querySelector('.job-timeline'), job);
  }
}

function scheduleSummary(job) {
  if (job.schedulingMode === 'random' && job.window) {
    return `Randomized: ${new Date(job.window.start).toLocaleString()} – ${new Date(job.window.end).toLocaleString()}`;
  }
  if (job.scheduleAt) {
    return 'Scheduled: ' + new Date(job.scheduleAt).toLocaleString();
  }
  return 'Send immediately';
}

// Status light: yellow while the job is still working, green once it has
// finished (even if some recipients failed/bounced - it still completed), red
// only if the whole job errored out before it could run.
function jobLightState(status) {
  if (status === 'completed' || status === 'completed_with_errors') return 'done';
  if (status === 'error') return 'error';
  return 'progress'; // pending, sending, paused_daily_limit
}

function jobLightTitle(status) {
  if (status === 'completed') return 'Completed';
  if (status === 'completed_with_errors') return 'Completed (some sends failed)';
  if (status === 'error') return 'Errored before completing';
  return 'In progress';
}

function recipientPillClass(status) {
  if (status === 'sent') return 'completed';
  if (status === 'failed' || status === 'bounced') return 'error';
  if (status === 'fallback') return 'paused_daily_limit';
  return 'pending';
}

function renderRandomRecipients(job) {
  const rows = job.recipients
    .map((r) => {
      const when = r.status === 'fallback' ? 'standby' : r.sendAt ? new Date(r.sendAt).toLocaleString() : '?';
      return `<div class="recipient-row">${escapeHtml(r.email)} &mdash; ${when} <span class="status-pill status-${recipientPillClass(r.status)}">${r.status}</span></div>`;
    })
    .join('');
  const sent = job.recipients.filter((r) => r.status === 'sent').length;
  // Collapsed by default so long recipient lists don't make the card huge.
  return `<details class="recipient-details">
    <summary>Recipients (${job.recipients.length}) &mdash; ${sent} sent</summary>
    <div class="recipient-list">${rows}</div>
  </details>`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

document.getElementById('refreshBtn').addEventListener('click', loadJobs);
document.getElementById('clearFinishedBtn').addEventListener('click', async () => {
  await fetch('/api/jobs/archive-finished', { method: 'POST' });
  loadJobs();
});
document.getElementById('toggleDismissedBtn').addEventListener('click', () => {
  showDismissed = !showDismissed;
  loadJobs();
});
loadJobs();
loadTemplates();
loadSentEmails();
loadSendStatus();
setInterval(loadJobs, 15000);
setInterval(loadSentEmails, 15000);
setInterval(loadSendStatus, 15000);
