import nodemailer, { type Transporter } from 'nodemailer';

// Transactional email over SMTP. If SMTP isn't configured (dev / no provider),
// the message — including the action link — is logged to the console so flows
// stay testable without a mail server. Best-effort: never throws into a request.

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_FROM = process.env.EMAIL_FROM ?? 'LLM Panda <no-reply@llmpanda.app>';

export const APP_URL = (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
const SMTP_CONFIGURED = Boolean(SMTP_HOST && SMTP_PORT);

let transport: Transporter | null = null;
function getTransport(): Transporter {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure: Number(SMTP_PORT) === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
      // A local/trusted relay (e.g. host Postfix) typically presents a
      // self-signed cert for opportunistic STARTTLS. Don't reject it — the hop
      // is host-internal. (For an external SMTP provider, leave this true via
      // SMTP_STRICT_TLS=1.)
      tls: { rejectUnauthorized: process.env.SMTP_STRICT_TLS === '1' },
    });
  }
  return transport;
}

export async function sendEmail(to: string, subject: string, html: string, link?: string): Promise<void> {
  if (!SMTP_CONFIGURED) {
    console.log(`[email] (SMTP not configured) to=${to} subject="${subject}"${link ? ` link=${link}` : ''}`);
    return;
  }
  try {
    await getTransport().sendMail({ from: EMAIL_FROM, to, subject, html });
  } catch (e) {
    console.error('[email] send failed:', (e as Error).message);
  }
}

// Apex-styled, email-safe template (table layout, inline styles, solid colors,
// no JS/animation — those are stripped by Gmail/Outlook). Mirrors the dashboard
// pill button: green pill + dark circular chevron badge (static). Source preview
// lives in freellmapi/email-templates/*.email.html.
function apexEmail(opts: {
  eyebrowIcon: string;
  eyebrow: string;
  heading: string;
  body: string;
  buttonLabel: string;
  link: string;
  footnote: string;
  warning?: string;
}): string {
  const warn = opts.warning
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;"><tr><td style="background:#2b2410;border:1px solid #5c4a12;border-radius:12px;padding:12px 14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#f5a623;">${opts.warning}</td></tr></table>`
    : '';
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /></head>
<body style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0 0 24px 4px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="40" style="width:40px;height:40px;background:#5fb13a;border-radius:40px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:18px;color:#191919;line-height:40px;">P</td>
    <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:14px;letter-spacing:1px;color:#191919;text-transform:uppercase;">LLM PANDA</td>
  </tr></table>
</td></tr>
<tr><td style="background:#272727;border-radius:24px;padding:40px;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5fb13a;padding-bottom:18px;">${opts.eyebrowIcon}&nbsp;&nbsp;${opts.eyebrow}</div>
  <h1 style="margin:0 0 16px 0;font-family:'Unbounded',Arial,Helvetica,sans-serif;font-weight:bold;text-transform:uppercase;font-size:28px;line-height:1.15;color:#ffffff;letter-spacing:-0.3px;">${opts.heading}</h1>
  <p style="margin:0 0 30px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#b3b3b3;">${opts.body}</p>
  <a href="${opts.link}" style="text-decoration:none;display:inline-block;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" bgcolor="#5fb13a" style="border-radius:999px;"><tr>
      <td style="padding:0 4px 0 26px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:15px;line-height:48px;color:#191919;white-space:nowrap;">${opts.buttonLabel}</td>
      <td style="padding:4px 4px 4px 8px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td width="40" height="40" align="center" valign="middle" bgcolor="#191919" style="width:40px;height:40px;border-radius:999px;color:#5fb13a;font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:bold;line-height:40px;text-align:center;">&raquo;</td>
      </tr></table></td>
    </tr></table>
  </a>
  ${warn}
  <p style="margin:${opts.warning ? '20px' : '30px'} 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;word-break:break-all;">Button not working? Paste this link into your browser:<br><a href="${opts.link}" style="color:#5fb13a;text-decoration:none;">${opts.link}</a></p>
  <p style="margin:10px 0 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6f6f6f;">${opts.footnote}</p>
</td></tr>
<tr><td style="padding:24px 8px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6f6f6f;">&copy; LLM Panda &middot; One key. Every free LLM.</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

export async function sendVerificationEmail(to: string, token: string): Promise<void> {
  const link = `${APP_URL}/verify?token=${token}`;
  await sendEmail(to, 'Verify your LLM Panda email', apexEmail({
    eyebrowIcon: '&#10003;',
    eyebrow: 'Confirm your email',
    heading: 'Verify your email address',
    body: 'Welcome to LLM Panda. Confirm your email to activate your account and start routing requests across every free LLM provider behind one key.',
    buttonLabel: 'Verify email',
    link,
    footnote: "This link expires in 5 minutes. If you didn't create an account, ignore this email.",
  }), link);
}

// Password reset now uses a short numeric code (OTP) the user types into the
// reset form, instead of a magic link. Same white apex shell as apexEmail, but
// the action is a big monospaced code box rather than a button.
export async function sendPasswordResetEmail(to: string, code: string): Promise<void> {
  const html = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="color-scheme" content="light" /></head>
<body style="margin:0;padding:0;background:#ffffff;-webkit-text-size-adjust:100%;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background:#ffffff;"><tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;">
<tr><td style="padding:0 0 24px 4px;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td width="40" style="width:40px;height:40px;background:#5fb13a;border-radius:40px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:18px;color:#191919;line-height:40px;">P</td>
    <td style="padding-left:12px;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:14px;letter-spacing:1px;color:#191919;text-transform:uppercase;">LLM PANDA</td>
  </tr></table>
</td></tr>
<tr><td style="background:#272727;border-radius:24px;padding:40px;">
  <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#5fb13a;padding-bottom:18px;">&#128273;&nbsp;&nbsp;Password reset</div>
  <h1 style="margin:0 0 16px 0;font-family:'Unbounded',Arial,Helvetica,sans-serif;font-weight:bold;text-transform:uppercase;font-size:28px;line-height:1.15;color:#ffffff;letter-spacing:-0.3px;">Your reset code</h1>
  <p style="margin:0 0 24px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#b3b3b3;">Enter this code in the password-reset form to set a new password.</p>
  <div style="margin:0 0 24px 0;padding:18px 0;background:#191919;border:1px solid #3a3a3a;border-radius:14px;text-align:center;font-family:'Courier New',Courier,monospace;font-size:36px;letter-spacing:12px;font-weight:bold;color:#5fb13a;">${code}</div>
  <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#8a8a8a;">This code expires in 10 minutes and can be used once. If you didn't request a password reset, you can safely ignore this email.</p>
</td></tr>
<tr><td style="padding:24px 8px 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#6f6f6f;">&copy; LLM Panda &middot; One key. Every free LLM.</td></tr>
</table>
</td></tr></table>
</body></html>`;
  await sendEmail(to, `${code} is your LLM Panda reset code`, html);
}
