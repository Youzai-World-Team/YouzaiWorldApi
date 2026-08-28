export type ClientDeviceType = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export interface ClientDeviceIdentity {
  device?: string | null
  os?: string | null
}

export type ClientOperatingSystemType = 'windows' | 'linux' | 'macos' | 'ios' | 'android' | 'harmonyos'

export interface ClientOperatingSystemIdentity {
  os?: string | null
}

export type ClientBrowserType =
  | 'chrome'
  | 'edge'
  | 'firefox'
  | 'safari'
  | 'opera'
  | 'samsung'
  | 'wechat'
  | 'huawei'
  | 'xiaomi'
  | 'qq'
  | 'uc'
  | 'quark'

export interface ClientBrowserIdentity {
  browser?: string | null
}

export function classifyClientDevice(client: ClientDeviceIdentity | null | undefined): ClientDeviceType {
  const device = String(client?.device || '')
  const os = String(client?.os || '')
  const fingerprint = `${device} ${os}`

  if (/iPad|iPadOS|Tablet|平板|Kindle|Silk/i.test(fingerprint)) return 'tablet'
  if (/iPhone|iPod|iOS|Android|HarmonyOS|OpenHarmony|Mobile|Phone|手机|移动设备/i.test(fingerprint)) return 'mobile'
  if (/Windows|macOS|Mac OS|Linux|ChromeOS|CrOS|桌面/i.test(fingerprint)) return 'desktop'
  return 'unknown'
}

export function clientDeviceIcon(client: ClientDeviceIdentity | null | undefined): string {
  const type = classifyClientDevice(client)
  if (type === 'mobile') return 'smartphone'
  if (type === 'tablet') return 'tablet_mac'
  if (type === 'desktop') return 'computer'
  return 'devices_other'
}

export function clientDeviceTypeLabel(client: ClientDeviceIdentity | null | undefined): string {
  const type = classifyClientDevice(client)
  if (type === 'mobile') return '移动端设备'
  if (type === 'tablet') return '平板设备'
  if (type === 'desktop') return '桌面端设备'
  return '未知设备类型'
}

export function classifyClientOperatingSystem(
  client: ClientOperatingSystemIdentity | null | undefined,
): ClientOperatingSystemType | null {
  const os = String(client?.os || '')
  if (/HarmonyOS|OpenHarmony/i.test(os)) return 'harmonyos'
  if (/Android/i.test(os)) return 'android'
  if (/iPadOS|iOS/i.test(os)) return 'ios'
  if (/macOS|Mac OS/i.test(os)) return 'macos'
  if (/Windows/i.test(os)) return 'windows'
  if (/Linux/i.test(os)) return 'linux'
  return null
}

export function clientOperatingSystemLabel(client: ClientOperatingSystemIdentity | null | undefined): string | null {
  const type = classifyClientOperatingSystem(client)
  if (type === 'windows') return 'Windows'
  if (type === 'linux') return 'Linux'
  if (type === 'macos') return 'macOS'
  if (type === 'ios') return 'iOS'
  if (type === 'android') return 'Android'
  if (type === 'harmonyos') return 'HarmonyOS'
  return null
}

export function classifyClientBrowser(client: ClientBrowserIdentity | null | undefined): ClientBrowserType | null {
  const browser = String(client?.browser || '')
  if (/微信内置浏览器|MicroMessenger/i.test(browser)) return 'wechat'
  if (/华为浏览器|HuaweiBrowser/i.test(browser)) return 'huawei'
  if (/小米浏览器|MiuiBrowser/i.test(browser)) return 'xiaomi'
  if (/QQ\s*浏览器|QQBrowser/i.test(browser)) return 'qq'
  if (/UC\s*浏览器|UCBrowser/i.test(browser)) return 'uc'
  if (/夸克浏览器|Quark/i.test(browser)) return 'quark'
  if (/Samsung Internet|SamsungBrowser/i.test(browser)) return 'samsung'
  if (/Edge|Edg(?:e|A|iOS)?/i.test(browser)) return 'edge'
  if (/Opera|OPR|OPiOS/i.test(browser)) return 'opera'
  if (/Firefox|FxiOS/i.test(browser)) return 'firefox'
  if (/Chrome|CriOS/i.test(browser)) return 'chrome'
  if (/Safari/i.test(browser)) return 'safari'
  return null
}

export function clientBrowserLabel(client: ClientBrowserIdentity | null | undefined): string | null {
  const type = classifyClientBrowser(client)
  if (type === 'chrome') return 'Chrome'
  if (type === 'edge') return 'Edge'
  if (type === 'firefox') return 'Firefox'
  if (type === 'safari') return 'Safari'
  if (type === 'opera') return 'Opera'
  if (type === 'samsung') return 'Samsung Internet'
  if (type === 'wechat') return '微信内置浏览器'
  if (type === 'huawei') return '华为浏览器'
  if (type === 'xiaomi') return '小米浏览器'
  if (type === 'qq') return 'QQ 浏览器'
  if (type === 'uc') return 'UC 浏览器'
  if (type === 'quark') return '夸克浏览器'
  return null
}
