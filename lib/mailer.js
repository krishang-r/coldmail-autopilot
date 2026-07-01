const nodemailer = require('nodemailer');

function getTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error(
      'GMAIL_USER / GMAIL_APP_PASSWORD not set. Copy .env.example to .env and fill it in.'
    );
  }
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });
}

function fillTemplate(template, vars) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (_, key) => vars[key] ?? '');
}

// CAN-SPAM (and basic deliverability hygiene) requires a working opt-out and a
// physical postal address in every commercial message. Append a small footer
// unless the sender has already written their own unsubscribe wording, or has
// explicitly turned the footer off.
function buildFooter() {
  if (String(process.env.APPEND_COMPLIANCE_FOOTER || 'true').toLowerCase() === 'false') {
    return '';
  }
  const senderName = process.env.SENDER_NAME || process.env.GMAIL_USER || '';
  const unsubEmail = process.env.UNSUBSCRIBE_EMAIL || process.env.GMAIL_USER || '';
  const address = process.env.SENDER_ADDRESS || '';

  const lines = ['', '--'];
  if (senderName) lines.push(senderName);
  if (unsubEmail) {
    lines.push(
      `Not the right inbox, or would you rather not hear from me? Reply to this email with "unsubscribe" (or email ${unsubEmail}) and I won't reach out again.`
    );
  }
  if (address) lines.push(address);
  return lines.join('\n');
}

function withFooter(body) {
  const footer = buildFooter();
  if (!footer) return body;
  // Don't double up if the sender already included their own opt-out language.
  if (/unsubscrib/i.test(body)) return body;
  return `${body}\n${footer}\n`;
}

async function sendOne(transporter, { to, subject, body, company, attachment }) {
  const fromName = process.env.SENDER_NAME || process.env.GMAIL_USER;
  const filledBody = withFooter(fillTemplate(body, { company }));

  const headers = {};
  // A machine-readable one-click-style unsubscribe is one of the strongest
  // signals inbox providers use to keep legitimate mail out of spam. We only
  // have a mailto (no public HTTPS endpoint from a local app), which is valid
  // on its own; we deliberately do NOT claim List-Unsubscribe-Post=One-Click
  // because that requires an HTTPS POST target.
  const unsubEmail = process.env.UNSUBSCRIBE_EMAIL || process.env.GMAIL_USER;
  if (unsubEmail) {
    headers['List-Unsubscribe'] = `<mailto:${unsubEmail}?subject=Unsubscribe>`;
  }

  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject: fillTemplate(subject, { company }),
    text: filledBody,
    headers,
  };

  const replyTo = process.env.REPLY_TO;
  if (replyTo) mailOptions.replyTo = replyTo;

  if (attachment) {
    mailOptions.attachments = [
      { filename: attachment.originalName, path: attachment.path },
    ];
  }
  return transporter.sendMail(mailOptions);
}

module.exports = { getTransporter, sendOne, fillTemplate, withFooter };
