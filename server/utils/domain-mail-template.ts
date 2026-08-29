/**
 * Bundled domain-mail template. Keeping the HTML in a TypeScript module makes
 * Nitro include it in the server bundle instead of relying on a deployment file.
 */
export const DOMAIN_MAIL_TEMPLATE_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title data-yzw-field="subject">{{subject}}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3fbf7;color:#333333;font-family:Arial,'Microsoft YaHei','Noto Sans CJK SC',sans-serif;">
    <div data-yzw-field="preheader" style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{{preheader}}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f3fbf7;background-image:linear-gradient(135deg,#f9fdfb 0%,#e8f7f1 100%);">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#ffffff;border:1px solid #dcedc1;border-radius:18px;box-shadow:0 12px 30px rgba(52,94,84,0.10);overflow:hidden;">
                  <!-- 头部：logo -->
                  <tr>
                    <td style="padding:18px 28px;background-color:#eefaf5;border-top:4px solid #a8e6cf;border-bottom:1px solid #dcedc1;">
                      <img src="https://assets.mcyzw.top/images/uzw-tm.png" width="240" alt="Youzai-World" style="display:block;width:240px;max-width:100%;height:auto;border:0;">
                    </td>
                  </tr>
                  <!-- 正文 -->
                  <tr>
                    <td style="padding:32px 36px;">
                      <div data-yzw-field="eyebrow" style="font-size:13px;line-height:1.6;color:#6bb39b;font-weight:700;letter-spacing:1px;">{{eyebrow}}</div>
                      <h1 data-yzw-field="heading" style="margin:8px 0 18px;font-size:25px;line-height:1.35;color:#345e54;font-weight:700;">{{heading}}</h1>

                      <p data-yzw-field="greeting" style="margin:0 0 16px;font-size:16px;line-height:1.8;color:#333333;">{{greeting}}</p>

                      <p data-yzw-field="body" style="margin:0 0 16px;font-size:15px;line-height:1.8;color:#555555;">{{body}}</p>

                      <!-- 落款：靠右对齐两行 -->
                      <div style="text-align:right;margin-top:20px;font-size:15px;line-height:1.8;color:#333333;">
                        <div data-yzw-field="senderName" style="font-weight:600;color:#345e54;">{{senderName}}</div>
                        <div data-yzw-field="senderRole" style="font-weight:400;color:#555555;">{{senderRole}}</div>
                      </div>

                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <!-- 底部版权信息（保留，符合验证码风格） -->
            <tr>
              <td align="center" style="padding:20px 16px 0;color:#6d827a;font-size:12px;line-height:1.7;">
                <div>悠哉世界 · <a href="https://mcyzw.top" style="color:#6bb39b;text-decoration:none;">mcyzw.top</a></div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`
