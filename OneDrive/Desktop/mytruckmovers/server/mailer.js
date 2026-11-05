// Sends password-reset codes by email. If SMTP isn't configured, it logs the
// code to the console instead so the app still works during local development.
let nodemailer;
try { nodemailer = require('nodemailer'); } catch { /* dependency not installed yet */ }

let transporter = null, tried = false;
function getTransporter() {
  if (tried) return transporter;
  tried = true;
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: +process.env.SMTP_PORT || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

async function sendMail({ to, subject, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`[mail] SMTP not configured — would send to ${to}: "${subject}" — ${text}`);
    return { sent: false };
  }
  await t.sendMail({ from: process.env.MAIL_FROM || 'MyTruckMovers <no-reply@example.com>', to, subject, text });
  return { sent: true };
}

module.exports = { sendMail };
