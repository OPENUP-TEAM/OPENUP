/**
 * Sending email.
 *
 * No provider is configured yet, so in development the message is printed
 * to the server console. That is deliberate rather than a stub: a password
 * reset flow that silently does nothing would look like it worked and lock
 * people out with no sign of why. Printing it means the link is usable
 * while testing, and the absence of a provider is visible.
 *
 * Before launch, set SMTP or an API provider here. Nothing else in the
 * codebase needs to change.
 */

const FROM = 'OpenUp <no-reply@openup.ph>';

export const isConfigured = () => Boolean(process.env.SMTP_URL || process.env.RESEND_API_KEY);

/**
 * @returns {Promise<{sent: boolean, preview?: string}>}
 *   `sent` false means it was logged, not delivered. Callers must not tell
 *   the person an email is on its way when it is not.
 */
export async function sendEmail({ to, subject, text }) {
  if (!isConfigured()) {
    console.log('\n--- EMAIL NOT SENT: no provider configured ---');
    console.log(`To:      ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(text);
    console.log('--- copy any link above to continue testing ---\n');
    return { sent: false, preview: text };
  }

  // Resend is the least work to add; any provider fits this shape.
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({ from: FROM, to, subject, text }),
    });
    if (!res.ok) throw new Error(`Email failed (${res.status})`);
    return { sent: true };
  }

  throw new Error('SMTP_URL is set but no SMTP client is installed. Use RESEND_API_KEY, or add nodemailer.');
}

export function resetEmail(name, url, minutes) {
  return {
    subject: 'Reset your OpenUp password',
    text: `Hi ${name},

Someone asked to reset the password for your OpenUp account. If that was you, open this link:

${url}

The link works once and expires in ${minutes} minutes.

If it was not you, you can ignore this. Your password has not changed, and nobody can get in without this link.

OpenUp`,
  };
}
