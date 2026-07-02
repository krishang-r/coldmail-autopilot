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

// This tool is only ever used for personal, 1:1 job applications - never bulk
// outreach - so emails are sent exactly as written, with nothing appended.
// No compliance/unsubscribe footer and no List-Unsubscribe header: those are
// bulk-mail conventions (and CAN-SPAM applies to commercial email, which a job
// application isn't). Adding either would make a personal email read - to both
// the recipient and spam filters - as mass marketing, the opposite of what we
// want here.
async function sendOne(transporter, { to, subject, body, company, attachment }) {
  const fromName = process.env.SENDER_NAME || process.env.GMAIL_USER;

  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject: fillTemplate(subject, { company }),
    text: fillTemplate(body, { company }),
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

module.exports = { getTransporter, sendOne, fillTemplate };
