export interface ClientDeviceInfo {
  browser: string
  os: string
  device: string
}

function versionLabel(name: string, version?: string): string {
  return version ? `${name} ${version.replace(/_/g, '.')}` : name
}

function parseBrowser(userAgent: string): string {
  const matchers: Array<[RegExp, string]> = [
    [/MicroMessenger\/([\d.]+)/, '微信内置浏览器'],
    [/HuaweiBrowser\/([\d.]+)/, '华为浏览器'],
    [/MiuiBrowser\/([\d.]+)/, '小米浏览器'],
    [/QQBrowser\/([\d.]+)/, 'QQ 浏览器'],
    [/UCBrowser\/([\d.]+)/, 'UC 浏览器'],
    [/Quark\/([\d.]+)/, '夸克浏览器'],
    [/EdgiOS\/([\d.]+)/, 'Edge'],
    [/EdgA\/([\d.]+)/, 'Edge'],
    [/Edg\/([\d.]+)/, 'Edge'],
    [/OPiOS\/([\d.]+)/, 'Opera'],
    [/OPR\/([\d.]+)/, 'Opera'],
    [/SamsungBrowser\/([\d.]+)/, 'Samsung Internet'],
    [/FxiOS\/([\d.]+)/, 'Firefox'],
    [/Firefox\/([\d.]+)/, 'Firefox'],
    [/CriOS\/([\d.]+)/, 'Chrome'],
    [/Chrome\/([\d.]+)/, 'Chrome'],
  ]

  for (const [pattern, name] of matchers) {
    const match = userAgent.match(pattern)
    if (match) return versionLabel(name, match[1])
  }

  const safari = userAgent.match(/Version\/([\d.]+).*Safari\//)
  if (safari) return versionLabel('Safari', safari[1])
  return '未知浏览器'
}

function parseOperatingSystem(userAgent: string, platformHint: string): string {
  const windows = userAgent.match(/Windows NT ([\d.]+)/)
  if (windows) {
    const versions: Record<string, string> = {
      '10.0': 'Windows 10/11',
      '6.3': 'Windows 8.1',
      '6.2': 'Windows 8',
      '6.1': 'Windows 7',
    }
    return versions[windows[1]] || 'Windows'
  }

  const android = userAgent.match(/Android ([\d.]+)/)
  if (android) return versionLabel('Android', android[1])

  const ios = userAgent.match(/(?:iPhone OS|CPU (?:iPhone )?OS) ([\d_]+)/)
  if (ios) return versionLabel(/iPad/.test(userAgent) ? 'iPadOS' : 'iOS', ios[1])

  const macOs = userAgent.match(/Mac OS X ([\d_]+)/)
  if (macOs) return versionLabel('macOS', macOs[1])

  const chromeOs = userAgent.match(/CrOS [^ ]+ ([\d.]+)/)
  if (chromeOs) return versionLabel('ChromeOS', chromeOs[1])
  if (/Linux/.test(userAgent)) return 'Linux'

  const cleanHint = platformHint.replace(/^"|"$/g, '').trim().slice(0, 32)
  return cleanHint || '未知系统'
}

function parseDevice(userAgent: string, mobileHint: string): string {
  if (/iPad/.test(userAgent)) return 'iPad'
  if (/iPhone/.test(userAgent)) return 'iPhone'
  if (/iPod/.test(userAgent)) return 'iPod'

  if (/Android/.test(userAgent)) {
    const model = userAgent.match(/Android [^;\)]+;\s*([^;\)]+?)(?:\s+Build\/[^;\)]+)?[;\)]/)?.[1]?.trim()
    if (model && !/^(?:wv|[a-z]{1,2})$/i.test(model)) return model.slice(0, 64)
    return /Mobile/.test(userAgent) || mobileHint === '?1' ? 'Android 手机' : 'Android 平板'
  }

  if (/Windows|Macintosh|CrOS|Linux/.test(userAgent)) return '桌面设备'
  if (/Tablet/.test(userAgent)) return '平板设备'
  if (/Mobile/.test(userAgent) || mobileHint === '?1') return '移动设备'
  return '未知设备'
}

export function describeClient(
  rawUserAgent: string | undefined,
  rawPlatformHint: string | undefined,
  rawMobileHint: string | undefined,
): ClientDeviceInfo {
  const userAgent = String(rawUserAgent || '').replace(/[\r\n]/g, ' ').slice(0, 1024)
  const platformHint = String(rawPlatformHint || '').replace(/[\r\n]/g, ' ').slice(0, 64)
  const mobileHint = String(rawMobileHint || '').trim().slice(0, 8)

  return {
    browser: parseBrowser(userAgent).slice(0, 64),
    os: parseOperatingSystem(userAgent, platformHint).slice(0, 64),
    device: parseDevice(userAgent, mobileHint).slice(0, 64),
  }
}
