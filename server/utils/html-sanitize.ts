/**
 * 邮件 HTML 正文净化：允许列表式，只保留排版必需的标签、属性与样式。
 *
 * <p>
 * 这是纵深防御的**第一层**。第二层在前端：净化结果被塞进
 * {@code <iframe sandbox="" srcdoc>}，并且该文档自带
 * {@code default-src 'none'} 的 CSP——即使这里被绕过，脚本也执行不了、
 * 远程资源也发不出去。两层都不依赖对方成立。
 * </p>
 *
 * <p>
 * 采用允许列表而非黑名单：没被显式列出的标签、属性、CSS 属性一律丢弃，
 * 所以 {@code on*}、{@code srcset}、{@code formaction}、{@code xlink:href}
 * 之类的新老危险属性不需要逐个枚举也进不来。
 * </p>
 */

/** 允许保留的标签 → 该标签额外允许的属性（全局属性见 GLOBAL_ATTRS）。 */
const ALLOWED_TAGS = new Map<string, Set<string>>([
  ['a', new Set()],
  ['abbr', new Set()],
  ['b', new Set()],
  ['blockquote', new Set()],
  /**
   * <body> 降级成 <div> 输出，只为保住它身上的 class / bgcolor / style——
   * 邮件很常在 body 上设整页背景色，直接跳过标签会把这层背景丢掉。
   */
  ['body', new Set(['bgcolor'])],
  ['br', new Set()],
  ['caption', new Set()],
  ['center', new Set()],
  ['code', new Set()],
  ['col', new Set(['span', 'width'])],
  ['colgroup', new Set(['span', 'width'])],
  ['dd', new Set()],
  ['div', new Set()],
  ['dl', new Set()],
  ['dt', new Set()],
  ['em', new Set()],
  ['figcaption', new Set()],
  ['figure', new Set()],
  ['font', new Set(['color', 'face', 'size'])],
  ['h1', new Set()],
  ['h2', new Set()],
  ['h3', new Set()],
  ['h4', new Set()],
  ['h5', new Set()],
  ['h6', new Set()],
  ['hr', new Set()],
  ['i', new Set()],
  ['img', new Set(['alt', 'width', 'height'])],
  ['li', new Set(['value'])],
  ['ol', new Set(['start', 'type'])],
  ['p', new Set()],
  ['pre', new Set()],
  ['s', new Set()],
  ['small', new Set()],
  ['span', new Set()],
  ['strike', new Set()],
  ['strong', new Set()],
  ['sub', new Set()],
  ['sup', new Set()],
  ['table', new Set(['bgcolor', 'border', 'cellpadding', 'cellspacing', 'width'])],
  ['tbody', new Set(['bgcolor'])],
  ['td', new Set(['bgcolor', 'colspan', 'rowspan', 'valign', 'width', 'height', 'nowrap'])],
  ['tfoot', new Set(['bgcolor'])],
  ['th', new Set(['bgcolor', 'colspan', 'rowspan', 'valign', 'width', 'height', 'nowrap'])],
  ['thead', new Set(['bgcolor'])],
  ['tr', new Set(['bgcolor', 'valign', 'height'])],
  ['u', new Set()],
  ['ul', new Set()],
  ['wbr', new Set()],
])

const GLOBAL_ATTRS = new Set(['title', 'dir', 'lang', 'align', 'style', 'class', 'id'])

/** 这些标签连内容一起丢：要么能执行代码，要么能发起请求，要么会破坏文档结构。 */
const DROP_WITH_CONTENT = new Set([
  'script', 'iframe', 'object', 'embed', 'applet', 'noscript',
  'template', 'svg', 'math', 'form', 'select', 'textarea', 'button', 'input',
  'frame', 'frameset', 'title', 'base', 'link', 'meta', 'map', 'area',
  'audio', 'video', 'source', 'track', 'canvas', 'portal', 'dialog',
])
// 注意：
// - 'style' 不在此列，它由 sanitizeCss 单独做受限支持（见下）。
// - 'head' 也不在此列：邮件常把 <style> 放在 <head> 里，整块丢掉会连样式一起丢。
//   <head> 自己不在 ALLOWED_TAGS 中，标签会被跳过、内容继续处理；其中的
//   <title>/<meta>/<link> 仍在上面的列表里各自丢弃。

/**
 * 无闭合标签（HTML void elements）。
 * <p>
 * 这里必须囊括 DROP_WITH_CONTENT 里那些同样是 void 的标签（meta / link / base /
 * input / source / track / area / embed / param / frame）：它们永远没有结束标签，
 * 若按「连内容一起丢」去找 {@code </meta>}，会一路找到文末，把整封邮件的正文
 * 全部丢掉。绝大多数 HTML 邮件的 head 里都有 {@code <meta charset>}，
 * 漏掉这一条会导致正文整体消失。
 * </p>
 */
const VOID_TAGS = new Set([
  'br', 'hr', 'img', 'wbr', 'col',
  'meta', 'link', 'base', 'input', 'source', 'track', 'area', 'embed', 'param', 'frame',
])

/**
 * 允许保留的内联 CSS 属性。
 * <p>
 * 排除 position / visibility / opacity / z-index / transform 等：它们能把内容
 * 盖到别处，也是垃圾邮件藏字的常用手段。{@code display} 出于排版需要放行
 * （多栏与响应式邮件靠它），但值为 {@code none} 时单独丢弃，这样既不破坏布局，
 * 又能让原本藏起来的文字现形。
 * </p>
 * <p>
 * {@code background} 系列一并放行：值里含 {@code url()} 的声明已经被
 * STYLE_VALUE_BLOCKLIST 整条拦掉，剩下的纯色背景对邮件排版很关键。
 * </p>
 */
const ALLOWED_STYLE_PROPS = new Set([
  'background', 'background-color', 'background-position', 'background-repeat',
  'background-size', 'border', 'border-bottom', 'border-bottom-color', 'border-collapse',
  'border-color', 'border-left', 'border-left-color', 'border-radius', 'border-right',
  'border-right-color', 'border-spacing', 'border-style', 'border-top', 'border-top-color',
  'border-width', 'box-sizing', 'caption-side', 'clear', 'color', 'display', 'empty-cells',
  'float', 'font', 'font-family', 'font-size', 'font-style', 'font-variant',
  'font-weight', 'height', 'letter-spacing', 'line-height', 'list-style', 'list-style-position',
  'list-style-type', 'margin',
  'margin-bottom', 'margin-left', 'margin-right', 'margin-top', 'max-height', 'max-width',
  'min-height', 'min-width', 'overflow-wrap', 'padding', 'padding-bottom', 'padding-left',
  'padding-right', 'padding-top', 'table-layout', 'text-align', 'text-decoration',
  'text-indent', 'text-transform',
  'vertical-align', 'white-space', 'width', 'word-break', 'word-wrap',
])

/** CSS 值里出现这些片段就整条丢弃：能拉远程资源、能在旧引擎里求值、能提前闭合注释。 */
const STYLE_VALUE_BLOCKLIST = [
  'url(', 'expression', 'javascript:', 'vbscript:', 'data:', '@import', '/*', '*/', '\\',
  '<', 'attr(', 'element(', 'image-set(', 'var(',
]

/** 只放行内联的 data: 图片；其余（含远程与 cid:）都换成占位提示。 */
const DATA_IMAGE_RE = /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp);base64,[A-Za-z0-9+/=\s]+$/i

const MAX_OUTPUT_LENGTH = 512 * 1024
const MAX_DEPTH = 64
const MAX_ATTR_VALUE_LENGTH = 4096

// ===== <style> 受限支持 =====
const MAX_CSS_OUTPUT = 128 * 1024
const MAX_CSS_RULES = 3000
const MAX_SELECTOR_LENGTH = 512
const MAX_AT_RULE_DEPTH = 2
/** 只放行这两个块级 at-rule；@import / @font-face / @charset 之类一律丢。 */
const ALLOWED_AT_RULES = new Set(['media', 'supports'])
/**
 * 选择器允许的字符集。
 * 刻意不含 `<` `{` `}` `;` `@` `\`：它们既能提前闭合 {@code </style>}，
 * 也能拼出新的规则块。
 */
const SELECTOR_RE = /^[a-zA-Z0-9\s.#\-_*>+~,:()[\]="'^$|]+$/
/** @media / @supports 的条件部分：同样不许出现能闭合标签或造新规则的字符。 */
const AT_PRELUDE_RE = /^[a-zA-Z0-9\s:()\-,./%]*$/
/** class / id 值：不允许以 yzw- 开头，避免邮件冒用预览容器自己的类名。 */
const CSS_IDENT_RE = /^[A-Za-z_][\w-]{0,63}$/

export interface SanitizedEmailHtml {
  html: string
  /** 从 `<style>` 里净化出来的 CSS，由前端放进沙箱文档的 head。 */
  css: string
  /** 被拦掉的图片数量（远程 URL 或 cid: 内联附件引用）。 */
  blockedImages: number
  /** 输出被截断（超长或嵌套过深）。 */
  truncated: boolean
}

/**
 * 转义文本，但保留已经合法的字符引用。
 * <p>
 * 直接把 {@code &} 全换成 {@code &amp;} 会让原文里的 {@code &nbsp;}
 * 显示成字面量，所以只转义不构成字符引用的裸 {@code &}。
 * </p>
 * <p>
 * 顺带剔除除制表符/换行/回车以外的控制字符。入库时
 * {@code inbound-mail.ts} 已经清过一遍，这里再清一次是为了让净化器自身完备，
 * 不依赖上游。
 * </p>
 */
function escapeText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/&(?!(?:#\d{1,7}|#[xX][0-9a-fA-F]{1,6}|[a-zA-Z][a-zA-Z0-9]{1,31});)/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeAttr(value: string): string {
  return escapeText(value).replace(/"/g, '&quot;')
}

function isPositiveNumber(value: string, max: number): boolean {
  if (!/^\d{1,7}$/.test(value)) return false
  const parsed = Number(value)
  return parsed >= 0 && parsed <= max
}

/**
 * width / height 属性：允许纯数字、百分比与 px。
 * 邮件里 `width="600"` 和 `width="600px"` 都很常见，calc 之类的表达式一律丢。
 */
function isLengthLike(value: string): boolean {
  return /^\d{1,6}(?:\.\d{1,3})?(?:%|px)?$/i.test(value)
}

/** 颜色字面量：#hex、颜色名、rgb()/rgba()/hsl()/hsla()。 */
function isColorLike(value: string): boolean {
  if (value.length > 64) return false
  return /^#[0-9a-f]{3,8}$/i.test(value)
    || /^[a-z]{1,32}$/i.test(value)
    || /^(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z%.,\s/-]{1,48}\)$/i.test(value)
}

function filterStyle(value: string): string {
  const kept: string[] = []
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':')
    if (separator <= 0) continue
    const property = declaration.slice(0, separator).trim().toLowerCase()
    let propertyValue = declaration.slice(separator + 1).trim()
    if (!ALLOWED_STYLE_PROPS.has(property)) continue
    if (!propertyValue || propertyValue.length > 256) continue

    const lowered = propertyValue.toLowerCase()
    if (STYLE_VALUE_BLOCKLIST.some((token) => lowered.includes(token))) continue
    // display 放行是为了保住多栏/响应式排版，但 none 会把内容藏起来：
    // 只丢这一个值，布局不受影响，垃圾邮件藏的字也能现形。
    if (property === 'display' && /^none$/.test(lowered)) continue
    // !important 会盖掉预览容器自己的排版兜底，去掉但保留声明本身。
    propertyValue = propertyValue.replace(/\s*!\s*important\s*$/i, '').trim()
    if (!propertyValue) continue
    kept.push(`${property}:${propertyValue}`)
  }
  return kept.join(';')
}

// ===== <style> 块的受限净化 =====

/** 去掉 CSS 注释：留着既能藏注释结束符提前闭合，也会干扰后面的分块解析。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ')
}

/** 从 openIndex 处的左花括号找到配对的右花括号，跳过字符串字面量。返回 -1 表示没配对。 */
function matchBrace(css: string, openIndex: number): number {
  let depth = 0
  let quote = ''
  for (let index = openIndex; index < css.length; index += 1) {
    const char = css[index]!
    if (quote) {
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * 校验选择器。
 * <p>
 * 逐个逗号分段检查，任一段非法就整条规则丢掉——比"只丢坏的那一段"更保守，
 * 也避免选择器被拼接成别的东西。
 * </p>
 */
function sanitizeSelector(raw: string): string {
  const selector = raw.trim().replace(/\s+/g, ' ')
  if (!selector || selector.length > MAX_SELECTOR_LENGTH) return ''
  if (!SELECTOR_RE.test(selector)) return ''
  for (const part of selector.split(',')) {
    if (!part.trim()) return ''
  }
  return selector
}

/**
 * 递归净化 CSS 规则列表。
 *
 * @param depth 当前 at-rule 嵌套深度
 * @param budget 全局规则数预算，防止一封信塞几万条规则
 */
function sanitizeCssRules(css: string, depth: number, budget: { rules: number }): string {
  const out: string[] = []
  let index = 0

  while (index < css.length) {
    while (index < css.length && /\s/.test(css[index]!)) index += 1
    if (index >= css.length) break
    if (budget.rules >= MAX_CSS_RULES) break
    budget.rules += 1

    // at-rule
    if (css[index] === '@') {
      let cursor = index + 1
      while (cursor < css.length && /[a-zA-Z-]/.test(css[cursor]!)) cursor += 1
      const name = css.slice(index + 1, cursor).toLowerCase()

      let preludeEnd = cursor
      while (preludeEnd < css.length && css[preludeEnd] !== ';' && css[preludeEnd] !== '{') preludeEnd += 1
      if (preludeEnd >= css.length) break

      // 语句型 at-rule（@import / @charset / @namespace）一律丢
      if (css[preludeEnd] === ';') {
        index = preludeEnd + 1
        continue
      }

      const blockEnd = matchBrace(css, preludeEnd)
      if (blockEnd === -1) break
      const prelude = css.slice(cursor, preludeEnd).trim()
      if (ALLOWED_AT_RULES.has(name) && depth < MAX_AT_RULE_DEPTH && AT_PRELUDE_RE.test(prelude)) {
        const inner = sanitizeCssRules(css.slice(preludeEnd + 1, blockEnd), depth + 1, budget)
        if (inner) out.push(`@${name} ${prelude}{${inner}}`)
      }
      index = blockEnd + 1
      continue
    }

    // 普通规则
    const braceStart = css.indexOf('{', index)
    if (braceStart === -1) break
    const blockEnd = matchBrace(css, braceStart)
    if (blockEnd === -1) break

    const selector = sanitizeSelector(css.slice(index, braceStart))
    const declarations = filterStyle(css.slice(braceStart + 1, blockEnd))
    if (selector && declarations) out.push(`${selector}{${declarations}}`)
    index = blockEnd + 1
  }

  return out.join('')
}

/**
 * 净化一个 `<style>` 块的内容。
 * <p>
 * 声明部分复用 {@link filterStyle}，所以 {@code url()} / {@code expression()} /
 * {@code display:none} 等在这里同样进不来；`@import` 被丢掉意味着无法引入远程样式表。
 * 选择器与 at-rule 条件都走白名单字符集，输出里不可能出现 {@code <}，
 * 因此不会提前闭合 {@code </style>}。
 * </p>
 */
export function sanitizeCss(input: unknown): string {
  const source = stripCssComments(String(input ?? ''))
  if (!source.trim()) return ''
  const css = sanitizeCssRules(source, 0, { rules: 0 })
  // 兜底：理论上不可能，但绝不允许输出里带 < 或 > 破坏宿主 <style> 元素
  if (/[<>]/.test(css)) return ''
  return css.length > MAX_CSS_OUTPUT ? '' : css
}

interface ParsedAttr {
  name: string
  value: string
}

/** 从 `<tag ...>` 的属性区解析出属性列表；同时兼容无引号与未闭合的写法。 */
function parseAttributes(source: string): ParsedAttr[] {
  const attrs: ParsedAttr[] = []
  let index = 0
  while (index < source.length) {
    while (index < source.length && /[\s/]/.test(source[index]!)) index += 1
    if (index >= source.length) break

    const nameStart = index
    while (index < source.length && !/[\s/=>]/.test(source[index]!)) index += 1
    const name = source.slice(nameStart, index).toLowerCase()
    if (!name) {
      index += 1
      continue
    }

    while (index < source.length && /\s/.test(source[index]!)) index += 1
    let value = ''
    if (source[index] === '=') {
      index += 1
      while (index < source.length && /\s/.test(source[index]!)) index += 1
      const quote = source[index]
      if (quote === '"' || quote === "'") {
        index += 1
        const end = source.indexOf(quote, index)
        value = end === -1 ? source.slice(index) : source.slice(index, end)
        index = end === -1 ? source.length : end + 1
      } else {
        const valueStart = index
        while (index < source.length && !/[\s>]/.test(source[index]!)) index += 1
        value = source.slice(valueStart, index)
      }
    }
    attrs.push({ name, value: value.slice(0, MAX_ATTR_VALUE_LENGTH) })
  }
  return attrs
}

/** 只解码属性值里最常见的引号/尖括号引用，用于判断 URL 协议时先还原一次。 */
function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#(\d{1,7});/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]{1,6});/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
}

/** 判断链接协议是否值得在预览里放出来（放出来也只是可点开弹窗，不是真跳转）。 */
function displayableUrl(rawValue: string): string {
  const value = decodeBasicEntities(rawValue).replace(/[\u0000-\u0020\u007f]/g, '')
  if (!value || value.length > 2048) return ''
  if (/^(?:https?:|mailto:)/i.test(value)) return value
  return ''
}

interface OpenTag {
  /** 原始标签名 */
  source: string
  /** 实际输出的标签名（<a> 会被降级成 <span>） */
  emitted: string
  /** 闭合后补在后面的内容 */
  suffix: string
}

/**
 * 净化邮件 HTML。
 *
 * @param input 原始 HTML 正文
 */
export function sanitizeEmailHtml(input: unknown): SanitizedEmailHtml {
  const source = String(input ?? '')
  if (!source.trim()) return { html: '', css: '', blockedImages: 0, truncated: false }

  const out: string[] = []
  const cssChunks: string[] = []
  let cssLength = 0
  const stack: OpenTag[] = []
  let blockedImages = 0
  let truncated = false
  let length = 0
  let index = 0

  const push = (chunk: string): boolean => {
    if (length + chunk.length > MAX_OUTPUT_LENGTH) {
      truncated = true
      return false
    }
    out.push(chunk)
    length += chunk.length
    return true
  }

  const closeAll = () => {
    while (stack.length) {
      const open = stack.pop()!
      out.push(`</${open.emitted}>`)
      if (open.suffix) out.push(open.suffix)
    }
  }

  while (index < source.length) {
    const next = source.indexOf('<', index)

    // 剩下的全是文本
    if (next === -1) {
      if (!push(escapeText(source.slice(index)))) break
      break
    }

    if (next > index) {
      if (!push(escapeText(source.slice(index, next)))) break
    }

    // 注释：整段丢掉（顺带挡住 IE 条件注释）
    if (source.startsWith('<!--', next)) {
      const end = source.indexOf('-->', next + 4)
      index = end === -1 ? source.length : end + 3
      continue
    }

    // <!DOCTYPE ...>、<![CDATA[...]]>、<?xml ...?>
    if (source.startsWith('<!', next) || source.startsWith('<?', next)) {
      const end = source.indexOf('>', next + 2)
      index = end === -1 ? source.length : end + 1
      continue
    }

    const isClosing = source.startsWith('</', next)
    const nameStart = next + (isClosing ? 2 : 1)
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9:-]*/.exec(source.slice(nameStart, nameStart + 64))

    // 不是标签，当普通文本处理（例如数学式里的 "a < b"）
    if (!nameMatch) {
      if (!push('&lt;')) break
      index = next + 1
      continue
    }

    const tagName = nameMatch[0].toLowerCase()
    const afterName = nameStart + nameMatch[0].length
    const tagEnd = (() => {
      // 属性值里可能含 '>'，扫描时要跳过引号
      let cursor = afterName
      let quote = ''
      while (cursor < source.length) {
        const char = source[cursor]!
        if (quote) {
          if (char === quote) quote = ''
        } else if (char === '"' || char === "'") {
          quote = char
        } else if (char === '>') {
          return cursor
        }
        cursor += 1
      }
      return -1
    })()
    if (tagEnd === -1) {
      // 标签没闭合，后面的内容无法可靠解析，直接停在这里
      truncated = true
      break
    }

    if (isClosing) {
      index = tagEnd + 1
      const depth = stack.findLastIndex((item) => item.source === tagName)
      if (depth === -1) continue
      // 闭合到该标签为止，顺手补齐中间没闭合的标签
      while (stack.length > depth) {
        const open = stack.pop()!
        if (!push(`</${open.emitted}>`)) break
        if (open.suffix && !push(open.suffix)) break
      }
      continue
    }

    const selfClosing = source[tagEnd - 1] === '/'
    const attrSource = source.slice(afterName, selfClosing ? tagEnd - 1 : tagEnd)
    index = tagEnd + 1

    // <style>：取出内容做受限净化，攒到 css 里由前端放进沙箱文档的 head。
    // 邮件的排版大量依赖它，整块丢掉会让现代模板塌成无样式的流式布局。
    if (tagName === 'style') {
      if (selfClosing) continue
      const rest = source.slice(index)
      const match = /<\/style[^>]*>/i.exec(rest)
      const inner = match ? rest.slice(0, match.index) : rest
      index = match ? index + match.index + match[0].length : source.length
      const sanitized = sanitizeCss(inner)
      if (sanitized) {
        if (cssLength + sanitized.length <= MAX_CSS_OUTPUT) {
          cssChunks.push(sanitized)
          cssLength += sanitized.length
        } else {
          truncated = true
        }
      }
      continue
    }

    // 连内容一起丢的标签：跳到它的闭合标签之后
    if (DROP_WITH_CONTENT.has(tagName)) {
      if (VOID_TAGS.has(tagName) || selfClosing) continue
      // 结束标签允许带垃圾内容（`</script foo>`），所以不能只匹配 `</script>`；
      // 找不到结束标签时丢弃剩余全文，宁可丢内容也不放行。
      const closeRe = new RegExp(`</${tagName}[^>]*>`, 'i')
      const rest = source.slice(index)
      const match = closeRe.exec(rest)
      index = match ? index + match.index + match[0].length : source.length
      continue
    }

    if (!ALLOWED_TAGS.has(tagName)) continue

    const attrs = parseAttributes(attrSource)
    const allowedExtra = ALLOWED_TAGS.get(tagName)!

    // <img>：只有内联 data: 图片能留下，其余换成占位提示
    if (tagName === 'img') {
      const srcAttr = attrs.find((attr) => attr.name === 'src')
      const altAttr = attrs.find((attr) => attr.name === 'alt')
      const rawSrc = decodeBasicEntities(srcAttr?.value ?? '').trim()
      if (!DATA_IMAGE_RE.test(rawSrc)) {
        blockedImages += 1
        const label = (altAttr?.value || '').trim()
        const hint = label ? `图片已拦截：${label}` : '图片已拦截'
        if (!push(`<span class="yzw-blocked-img">${escapeText(hint)}</span>`)) break
        continue
      }
    }

    if (stack.length >= MAX_DEPTH) {
      truncated = true
      continue
    }

    // <a> 降级成不可直接跳转的 <span>：前端脚本捕获点击，弹窗显示完整地址、
    // 由管理员自行复制到别处打开。真实地址放进 data-yzw-href，不做成 href，
    // 沙箱里也没有 allow-popups / allow-top-navigation，点了跳不出去。
    const emitted = tagName === 'a' ? 'span' : tagName === 'body' ? 'div' : tagName
    let suffix = ''
    const pieces: string[] = []

    if (tagName === 'a') {
      const url = displayableUrl(attrs.find((attr) => attr.name === 'href')?.value ?? '')
      if (url) {
        pieces.push('class="yzw-link" role="link" tabindex="0"')
        pieces.push(`data-yzw-href="${escapeAttr(url)}"`)
        pieces.push(`title="${escapeAttr(`点击查看链接：${url}`)}"`)
      } else {
        // javascript: / data: 之类的协议不给出可点入口，只标注原本有个可疑链接。
        pieces.push('class="yzw-link yzw-link--blocked"')
        pieces.push('title="已移除不安全链接"')
      }
    }

    for (const attr of attrs) {
      if (tagName === 'img' && attr.name === 'src') {
        pieces.push(`src="${escapeAttr(decodeBasicEntities(attr.value).trim())}"`)
        continue
      }
      const allowed = GLOBAL_ATTRS.has(attr.name) || allowedExtra.has(attr.name)
      if (!allowed) continue
      // <a> 已经降级并自带 class / title / href，邮件自己的这些属性不再采纳，
      // 以免覆盖或与我们注入的点击行为冲突。
      if (tagName === 'a' && (attr.name === 'title' || attr.name === 'class' || attr.name === 'href')) continue

      if (attr.name === 'style') {
        const style = filterStyle(decodeBasicEntities(attr.value))
        if (style) pieces.push(`style="${escapeAttr(style)}"`)
        continue
      }
      // class：保留合法标识符，供 <style> 里的选择器命中；但禁止 yzw- 前缀，
      // 免得邮件冒用预览容器/链接自己的类名。
      if (attr.name === 'class') {
        const classes = attr.value.trim().split(/\s+/)
          .filter((token) => CSS_IDENT_RE.test(token) && !/^yzw-/i.test(token))
          .slice(0, 32)
        if (classes.length) pieces.push(`class="${escapeAttr(classes.join(' '))}"`)
        continue
      }
      if (attr.name === 'id') {
        const id = attr.value.trim()
        if (CSS_IDENT_RE.test(id) && !/^yzw-/i.test(id)) pieces.push(`id="${escapeAttr(id)}"`)
        continue
      }
      if (attr.name === 'colspan' || attr.name === 'rowspan' || attr.name === 'span') {
        if (isPositiveNumber(attr.value.trim(), 1000)) pieces.push(`${attr.name}="${attr.value.trim()}"`)
        continue
      }
      if (attr.name === 'width' || attr.name === 'height') {
        if (isLengthLike(attr.value.trim())) pieces.push(`${attr.name}="${attr.value.trim()}"`)
        continue
      }
      // bgcolor / font color：纯展示颜色值。引号在 escapeAttr 里已转义，突破不了属性边界，
      // 这里再按颜色字面量收一遍，避免把无意义的垃圾塞进输出。
      if (attr.name === 'bgcolor' || (tagName === 'font' && attr.name === 'color')) {
        const color = attr.value.trim()
        if (isColorLike(color)) pieces.push(`${attr.name}="${escapeAttr(color)}"`)
        continue
      }
      if (tagName === 'font' && attr.name === 'size') {
        const size = attr.value.trim()
        // <font size> 是 1-7，也允许 +1 / -2 这种相对写法
        if (/^[+-]?[1-7]$/.test(size)) pieces.push(`size="${size}"`)
        continue
      }
      if (tagName === 'font' && attr.name === 'face') {
        const face = attr.value.trim()
        if (/^[\w\s,'"-]{1,128}$/.test(face)) pieces.push(`face="${escapeAttr(face)}"`)
        continue
      }
      // nowrap 是布尔属性，出现即生效
      if (attr.name === 'nowrap') {
        pieces.push('nowrap="nowrap"')
        continue
      }
      if (attr.name === 'border' || attr.name === 'cellpadding' || attr.name === 'cellspacing'
        || attr.name === 'start' || attr.name === 'value') {
        if (isPositiveNumber(attr.value.trim(), 100000)) pieces.push(`${attr.name}="${attr.value.trim()}"`)
        continue
      }
      if (attr.name === 'align' || attr.name === 'valign') {
        const normalized = attr.value.trim().toLowerCase()
        if (/^(?:left|right|center|justify|top|middle|bottom|baseline)$/.test(normalized)) {
          pieces.push(`${attr.name}="${normalized}"`)
        }
        continue
      }
      if (attr.name === 'dir') {
        const normalized = attr.value.trim().toLowerCase()
        if (/^(?:ltr|rtl|auto)$/.test(normalized)) pieces.push(`dir="${normalized}"`)
        continue
      }
      if (attr.name === 'type') {
        const normalized = attr.value.trim()
        if (/^[a1AiI]$/.test(normalized)) pieces.push(`type="${normalized}"`)
        continue
      }
      // 其余允许的属性（alt / title / lang）按纯文本处理
      pieces.push(`${attr.name}="${escapeAttr(attr.value)}"`)
    }

    const openTag = `<${emitted}${pieces.length ? ` ${pieces.join(' ')}` : ''}>`
    if (VOID_TAGS.has(tagName)) {
      if (!push(openTag)) break
      continue
    }
    if (!push(openTag)) break
    if (selfClosing) {
      if (!push(`</${emitted}>`)) break
      if (suffix && !push(suffix)) break
      continue
    }
    stack.push({ source: tagName, emitted, suffix })
  }

  closeAll()
  return { html: out.join(''), css: cssChunks.join('\n'), blockedImages, truncated }
}
