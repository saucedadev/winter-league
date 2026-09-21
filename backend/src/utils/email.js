import nodemailer from 'nodemailer';
import { config } from '../config.js';

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      auth: { user: config.email.brevoUser, pass: config.email.brevoPass },
    });
  }
  return transport;
}

// EMAIL_PROVIDER=console (default) prints the message to the server log,
// so every email flow can be tested locally without a Brevo account.
export async function sendEmail({ to, subject, text }) {
  if (config.email.provider !== 'brevo') {
    console.log(`\n📧 [email:console] To: ${to}\n   Subject: ${subject}\n   ${text.replace(/\n/g, '\n   ')}\n`);
    return;
  }
  await getTransport().sendMail({ from: config.email.from, to, subject, text });
}
