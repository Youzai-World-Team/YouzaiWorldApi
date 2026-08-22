import type { VerificationEmailTemplate } from './email-templates'

export const VERIFICATION_EMAIL_LOGO_URL = 'https://api.mcyzw.top/images/uzw-tm.png'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildVerificationEmailHtml(
  subjectText: string,
  username: string,
  code: string,
  template: VerificationEmailTemplate,
  logoUrl = VERIFICATION_EMAIL_LOGO_URL,
): string {
  const safeSubject = escapeHtml(subjectText)
  const safeHeading = escapeHtml(template.heading)
  const safeUsername = escapeHtml(username)
  const safeCode = escapeHtml(code)
  const safeIntro = escapeHtml(template.intro)
  const safeLogoUrl = escapeHtml(logoUrl)
  const safeDetails = template.details.map((detail) => `<div style="margin:0 0 6px;">${escapeHtml(detail)}</div>`).join('')

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeSubject}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3fbf7;color:#333333;font-family:Arial,'Microsoft YaHei','Noto Sans CJK SC',sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safeHeading}，验证码 10 分钟内有效。</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3fbf7;background-image:linear-gradient(135deg,#f9fdfb 0%,#e8f7f1 100%);">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;border:1px solid #dcedc1;border-radius:18px;box-shadow:0 12px 30px rgba(52,94,84,0.10);overflow:hidden;">
                  <tr>
                    <td style="padding:18px 28px;background-color:#eefaf5;border-top:4px solid #a8e6cf;border-bottom:1px solid #dcedc1;">
                      <img src="${safeLogoUrl}" width="240" alt="" style="display:block;width:240px;max-width:100%;height:auto;border:0;">
                    </td>
                  </tr>
                  <tr>
                    <td style="padding:32px 36px;">
                <div style="font-size:13px;line-height:1.6;color:#6bb39b;font-weight:700;letter-spacing:1px;">ACCOUNT SECURITY</div>
                <h1 style="margin:8px 0 18px;font-size:25px;line-height:1.35;color:#345e54;font-weight:700;">${safeHeading}</h1>
                <p style="margin:0 0 10px;font-size:16px;line-height:1.8;color:#333333;">你好，<strong style="color:#345e54;">${safeUsername}</strong>！</p>
                <p style="margin:0 0 24px;font-size:15px;line-height:1.8;color:#555555;">${safeIntro}</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:0 0 24px;background-color:#eefaf5;border:1px solid #a8e6cf;border-radius:14px;">
                  <tr>
                    <td align="center" style="padding:21px 16px 18px;">
                      <div style="font-size:13px;line-height:1.5;color:#6bb39b;font-weight:700;letter-spacing:1px;">邮箱验证码</div>
                      <div style="margin-top:8px;font-size:34px;line-height:1.2;color:#345e54;font-weight:700;letter-spacing:9px;">${safeCode}</div>
                    </td>
                  </tr>
                </table>
                <div style="padding:14px 16px;background-color:#fffaf0;border-left:4px solid #e7b94c;border-radius:6px;color:#6f5a27;font-size:14px;line-height:1.7;">${escapeHtml(template.expiryNotice)}</div>
                <div style="margin-top:22px;color:#666666;font-size:14px;line-height:1.8;">${safeDetails}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:20px 16px 0;color:#6d827a;font-size:12px;line-height:1.7;">
                <div>这是一封系统自动发送的邮件，请勿直接回复。</div>
                <div>悠哉世界 · <a href="https://mcyzw.top" style="color:#6bb39b;text-decoration:none;">mcyzw.top</a></div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

export function buildVerificationEmailTemplateSource(template: VerificationEmailTemplate): string {
  return buildVerificationEmailHtml('{{subject}}', '{{username}}', '{{code}}', template, '{{logoUrl}}')
}

export function replaceVerificationEmailHtmlPlaceholders(
  html: string,
  subject: string,
  username: string,
  code: string,
  logoUrl = VERIFICATION_EMAIL_LOGO_URL,
): string {
  const withText = html
    .replaceAll('{{subject}}', escapeHtml(subject))
    .replaceAll('{{username}}', escapeHtml(username))
    .replaceAll('{{code}}', escapeHtml(code))
  return withText.replace(/\{\{logoUrl\}\}|https:\/\/api\.mcyzw\.top\/images\/uzw-tm\.png|(?<!https?:)\/images\/uzw-tm\.png/g, escapeHtml(logoUrl))
}
