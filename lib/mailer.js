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

async function sendOne(transporter, { to, subject, body, company, attachment }) {
  const fromName = process.env.SENDER_NAME || process.env.GMAIL_USER;
  const mailOptions = {
    from: `"${fromName}" <${process.env.GMAIL_USER}>`,
    to,
    subject: fillTemplate(subject, { company }),
    text: fillTemplate(body, { company }),
  };
  if (attachment) {
    mailOptions.attachments = [
      { filename: attachment.originalName, path: attachment.path },
    ];
  }
  return transporter.sendMail(mailOptions);
}

module.exports = { getTransporter, sendOne, fillTemplate };
