export const EMAIL_PREVIEW_SCROLLBAR_CSS = `
* {
  scrollbar-width: thin;
  scrollbar-color: rgb(115 121 104 / 64%) rgb(234 240 221 / 42%);
}
*::-webkit-scrollbar { width: 10px; height: 10px; }
*::-webkit-scrollbar-track { border-radius: 999px; background: rgb(234 240 221 / 42%); }
*::-webkit-scrollbar-thumb {
  min-width: 36px;
  min-height: 36px;
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgb(115 121 104 / 64%);
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover { background: #8fbd59; background-clip: padding-box; }
*::-webkit-scrollbar-thumb:active { background: #8bc34a; background-clip: padding-box; }
*::-webkit-scrollbar-corner { background: transparent; }
*::-webkit-scrollbar-button { width: 0; height: 0; display: none; }
`.trim()

/** Add preview-only chrome without changing the HTML used for real delivery. */
export function addEmailPreviewScrollbar(html: string): string {
  const style = `<style data-yzw-preview-scrollbar>${EMAIL_PREVIEW_SCROLLBAR_CSS}</style>`
  const headEnd = html.search(/<\/head\s*>/i)
  return headEnd >= 0
    ? `${html.slice(0, headEnd)}${style}${html.slice(headEnd)}`
    : `${style}${html}`
}
