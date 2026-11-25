import { createTransport, type Transporter } from 'nodemailer';
import { config } from './config.ts';

let transport: Transporter | null = null;

export const mailEnabled = () => !!config.smtpUrl;

/** Sends a plain-text email. Returns false (and logs) when SMTP is not configured or sending fails. */
export async function sendMail(to: string, subject: string, text: string): Promise<boolean> {
  if (!config.smtpUrl) return false;
  transport ??= createTransport(config.smtpUrl);
  try {
    await transport.sendMail({ from: config.mailFrom || `${config.appName} <no-reply@${config.rpId}>`, to, subject, text });
    return true;
  } catch (e) {
    console.error('[opencookie] Sending email failed:', (e as Error).message);
    return false;
  }
}
