// ─── Resend email delivery ─────────────────────────────────────────────
// Uses Resend's HTTP API directly (no SDK dependency needed — one fetch
// call). Requires RESEND_API_KEY and RESEND_FROM_EMAIL to be set.

const RESEND_API_URL = 'https://api.resend.com/emails'

interface SendEmailParams {
  to: string
  subject: string
  html: string
}

/**
 * Sends an email via Resend. Throws on failure so callers can decide
 * how to handle delivery errors (the forgot-password route treats a
 * failed send as a hard error rather than silently pretending success,
 * since the user genuinely needs that code to get into their account).
 */
export async function sendEmail({ to, subject, html }: SendEmailParams): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM_EMAIL

  if (!apiKey || !from) {
    throw new Error('Email is not configured: RESEND_API_KEY / RESEND_FROM_EMAIL missing')
  }

  const res = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to, subject, html }),
  })

  if (!res.ok) {
    const errBody = await res.text().catch(() => '')
    throw new Error(`Resend API error (${res.status}): ${errBody}`)
  }
}

/** Builds the branded HTML for the "forgot password" OTP email. */
export function forgotPasswordOtpEmail(code: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your PostGo verification code</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f4f7; font-family:'Helvetica Neue', Helvetica, Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7; padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:10px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,0.06);">

          <tr>
            <td align="center" style="background-color:#0A66C2; padding:28px 20px;">
              <span style="color:#ffffff; font-size:22px; font-weight:700; letter-spacing:0.5px;">PostGo</span>
            </td>
          </tr>

          <tr>
            <td style="padding:36px 32px 20px 32px;">
              <h1 style="margin:0 0 12px 0; font-size:20px; color:#1a1a1a; font-weight:600;">Reset your password</h1>
              <p style="margin:0 0 20px 0; font-size:14px; line-height:22px; color:#555555;">
                We received a request to reset the password for your PostGo account. Use the verification code below to continue. This code expires in <strong>15 minutes</strong> and can only be used once.
              </p>
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:0 32px 24px 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="background-color:#f0f4fa; border:1px solid #dbe4f0; border-radius:8px; padding:18px;">
                    <span style="font-size:32px; font-weight:700; letter-spacing:8px; color:#0A66C2;">${code}</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 12px 32px;">
              <p style="margin:0; font-size:13px; line-height:20px; color:#888888;">
                Don't see this in your inbox? Please check your <strong>Spam</strong> or <strong>Promotions</strong> folder as well.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px 28px 32px;">
              <p style="margin:0; font-size:13px; line-height:20px; color:#888888;">
                If you didn't request a password reset, you can safely ignore this email — your password will remain unchanged. Never share this code with anyone, including PostGo staff.
              </p>
            </td>
          </tr>

          <tr>
            <td style="padding:0 32px;">
              <hr style="border:none; border-top:1px solid #eeeeee; margin:0;">
            </td>
          </tr>

          <tr>
            <td align="center" style="padding:20px 32px 32px 32px;">
              <p style="margin:0; font-size:12px; color:#aaaaaa;">
                &copy; ${new Date().getFullYear()} PostGo. All rights reserved.<br>
                This is an automated message, please do not reply.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
