import { timingSafeEqual, randomUUID } from 'node:crypto'
import { constants as fsConstants, createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import JSZip from 'jszip'

const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 20_000
const DEPLOY_LOCK_MAX_AGE_MS = 15 * 60 * 1000
const RESTART_DELAY_MS = 1_500
const DEPLOY_TOKEN_RE = /^\S{32,512}$/u
const CRC32_TABLE = new Uint32Array(256)
const DEPLOY_INFO_FILE = 'last-deployment.json'

for (let index = 0; index < CRC32_TABLE.length; index += 1) {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  }
  CRC32_TABLE[index] = value >>> 0
}

type DeployLock = Awaited<ReturnType<typeof fs.open>>

export interface DeployResult {
  releaseId: string
  files: number
  bytes: number
}

interface DeploymentInfo {
  releaseId: string
  deployedAt: number
}

function deployRoot(): string {
  return path.resolve(process.env.YZWC_DEPLOY_ROOT?.trim() || process.cwd())
}

function validDeploymentTime(value: unknown): value is number {
  return Number.isFinite(value)
    && Number(value) > 0
    && Number(value) <= Date.now() + 5 * 60 * 1000
}

async function recordDeployment(deployDir: string, releaseId: string): Promise<void> {
  const info: DeploymentInfo = { releaseId, deployedAt: Date.now() }
  try {
    await fs.writeFile(
      path.join(deployDir, DEPLOY_INFO_FILE),
      JSON.stringify(info),
      { encoding: 'utf8', mode: 0o600 },
    )
  } catch (error) {
    console.warn('部署已完成，但部署时间记录失败', error)
  }
}

export async function getLastDeploymentTime(): Promise<number> {
  const root = deployRoot()
  try {
    const content = await fs.readFile(path.join(root, '.deploy', DEPLOY_INFO_FILE), 'utf8')
    const info = JSON.parse(content) as Partial<DeploymentInfo>
    if (validDeploymentTime(info.deployedAt)) return info.deployedAt
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError)) {
      console.warn('读取部署时间记录失败', error)
    }
  }

  try {
    const stat = await fs.stat(path.join(root, '.output', 'server', 'index.mjs'))
    if (validDeploymentTime(stat.mtimeMs)) return stat.mtimeMs
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('读取部署产物时间失败', error)
    }
  }

  return Date.now() - Math.round(process.uptime() * 1000)
}

function configuredToken(): string {
  return process.env.YZWC_DEPLOY_TOKEN || ''
}

export function deployArchiveLimit(): number {
  return MAX_ARCHIVE_BYTES
}

export function deployIsConfigured(): boolean {
  return DEPLOY_TOKEN_RE.test(configuredToken())
}

export function deployTokenMatches(provided: string | undefined): boolean {
  const expected = configuredToken()
  if (!DEPLOY_TOKEN_RE.test(expected) || !provided || !DEPLOY_TOKEN_RE.test(provided)) return false

  const actualBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  return actualBuffer.length === expectedBuffer.length
    && timingSafeEqual(actualBuffer, expectedBuffer)
}

function safeArchivePath(rawName: string): string | null {
  if (!rawName || rawName.includes('\0')) return null

  const normalized = rawName.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return null

  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0 || parts.some(part => part === '.' || part === '..')) return null
  // Windows treats `name:stream` as an alternate data stream rather than a
  // child file. Reject device/stream syntax when the service runs there.
  if (process.platform === 'win32' && parts.some(part => /[<>:"|?*]/u.test(part))) return null
  return parts.join('/')
}

async function removeStaleLock(lockPath: string): Promise<void> {
  try {
    const stat = await fs.stat(lockPath)
    if (Date.now() - stat.mtimeMs > DEPLOY_LOCK_MAX_AGE_MS) {
      await fs.rm(lockPath, { force: true })
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function acquireDeployLock(deployDir: string): Promise<{ handle: DeployLock, path: string }> {
  await fs.mkdir(deployDir, { recursive: true })
  const lockPath = path.join(deployDir, 'deploy.lock')
  await removeStaleLock(lockPath)

  try {
    const handle = await fs.open(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY, 0o600)
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }))
    return { handle, path: lockPath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error('已有部署任务正在执行')
    }
    throw error
  }
}

async function releaseDeployLock(lock: { handle: DeployLock, path: string } | undefined): Promise<void> {
  if (!lock) return
  await lock.handle.close().catch(() => {})
  await fs.rm(lock.path, { force: true }).catch(() => {})
}

function isSymlink(entry: JSZip.JSZipObject): boolean {
  const permissions = typeof entry.unixPermissions === 'number'
    ? entry.unixPermissions
    : typeof entry.unixPermissions === 'string'
      ? Number.parseInt(entry.unixPermissions, 8)
      : NaN
  return Number.isFinite(permissions) && (permissions & 0o170000) === 0o120000
}

function updateCrc32(crc: number, chunk: Buffer): number {
  let value = crc
  for (const byte of chunk) {
    value = CRC32_TABLE[(value ^ byte) & 0xFF]! ^ (value >>> 8)
  }
  return value >>> 0
}

function expectedEntryCrc32(entry: JSZip.JSZipObject): number | undefined {
  const internal = entry as JSZip.JSZipObject & { _data?: { crc32?: number } }
  const crc = internal._data?.crc32
  return typeof crc === 'number' ? crc >>> 0 : undefined
}

async function extractArchive(archive: Buffer, destination: string): Promise<{ files: number, bytes: number }> {
  if (archive.length === 0) throw new Error('部署包为空')
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error('部署包超过 100 MiB 限制')

  const zip = await JSZip.loadAsync(archive, { checkCRC32: false, createFolders: false })
  const entries = Object.values(zip.files)
  if (entries.length === 0) throw new Error('部署包中没有文件')
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error('部署包文件数量过多')

  const seenPaths = new Set<string>()
  let files = 0
  let bytes = 0

  for (const entry of entries) {
    // JSZip sanitizes `../` segments and exposes the original name separately;
    // reject the original unsafe name instead of silently accepting it.
    const originalName = entry.unsafeOriginalName || entry.name
    const safeOriginalPath = safeArchivePath(originalName)
    const relativePath = safeArchivePath(entry.name)
    if (!safeOriginalPath || !relativePath || safeOriginalPath !== relativePath) {
      throw new Error(`部署包包含不安全路径: ${originalName}`)
    }
    if (isSymlink(entry)) throw new Error(`部署包不允许符号链接: ${entry.name}`)

    const pathKey = process.platform === 'win32' ? relativePath.toLowerCase() : relativePath
    if (seenPaths.has(pathKey)) throw new Error(`部署包包含重复路径: ${entry.name}`)
    seenPaths.add(pathKey)

    const outputPath = path.resolve(destination, relativePath)
    const relativeOutput = path.relative(destination, outputPath)
    if (!relativeOutput || relativeOutput.startsWith('..') || path.isAbsolute(relativeOutput)) {
      throw new Error(`部署包路径超出暂存目录: ${entry.name}`)
    }

    if (entry.dir) {
      await fs.mkdir(outputPath, { recursive: true })
      continue
    }

    await fs.mkdir(path.dirname(outputPath), { recursive: true })
    let entryBytes = 0
    let entryCrc32 = 0xFFFFFFFF
    const sizeLimiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        entryBytes += chunk.length
        if (bytes + entryBytes > MAX_EXTRACTED_BYTES) {
          callback(new Error('部署包解压后超过 512 MiB 限制'))
          return
        }
        entryCrc32 = updateCrc32(entryCrc32, chunk)
        callback(null, chunk)
      },
    })
    await pipeline(
      entry.nodeStream('nodebuffer'),
      sizeLimiter,
      createWriteStream(outputPath, { flags: 'wx', mode: 0o600 }),
    )
    const expectedCrc32 = expectedEntryCrc32(entry)
    const actualCrc32 = (entryCrc32 ^ 0xFFFFFFFF) >>> 0
    if (expectedCrc32 !== undefined && actualCrc32 !== expectedCrc32) {
      throw new Error(`Corrupted zip: CRC32 mismatch for ${entry.name}`)
    }
    bytes += entryBytes
    files += 1
  }

  return { files, bytes }
}

async function validateStagedOutput(stagedOutput: string): Promise<void> {
  // Nitro’s standalone output contains the server entrypoint; package.json is
  // intentionally not required because the generated archive does not need
  // the source tree or runtime dependency metadata to start.
  const requiredFiles = ['server/index.mjs']
  for (const relativePath of requiredFiles) {
    const stat = await fs.stat(path.join(stagedOutput, relativePath)).catch(() => null)
    if (!stat?.isFile()) throw new Error(`部署包缺少 Nuxt 产物: ${relativePath}`)
  }
}

async function swapOutput(root: string, stagedOutput: string, deployDir: string): Promise<void> {
  const liveOutput = path.join(root, '.output')
  const previousOutput = path.join(deployDir, 'previous-output')
  const liveExists = await fs.stat(liveOutput).then(stat => stat.isDirectory()).catch(() => false)

  await fs.rm(previousOutput, { recursive: true, force: true })
  if (liveExists) await fs.rename(liveOutput, previousOutput)

  try {
    await fs.rename(stagedOutput, liveOutput)
  } catch (error) {
    if (liveExists) await fs.rename(previousOutput, liveOutput).catch(() => {})
    throw error
  }
}

export async function deployNuxtOutput(archive: Buffer): Promise<DeployResult> {
  const root = deployRoot()
  const deployDir = path.join(root, '.deploy')
  const releaseId = `${Date.now()}-${randomUUID()}`
  const stagingDir = path.join(deployDir, `staging-${releaseId}`)
  let lock: { handle: DeployLock, path: string } | undefined

  try {
    lock = await acquireDeployLock(deployDir)
    await fs.mkdir(stagingDir, { recursive: true })
    const extracted = await extractArchive(archive, stagingDir)
    await validateStagedOutput(stagingDir)
    await swapOutput(root, stagingDir, deployDir)
    await recordDeployment(deployDir, releaseId)
    return { releaseId, ...extracted }
  } finally {
    await fs.rm(stagingDir, { recursive: true, force: true }).catch(() => {})
    await releaseDeployLock(lock)
  }
}

export function scheduleDeployRestart(): 'command' | 'exit' {
  const restartCommand = process.env.YZWC_DEPLOY_RESTART_COMMAND?.trim()

  setTimeout(() => {
    if (!restartCommand) {
      process.exit(0)
    }

    const shell = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : '/bin/sh'
    const args = process.platform === 'win32'
      ? ['/d', '/s', '/c', restartCommand]
      : ['-c', restartCommand]
    const child = spawn(shell, args, {
      cwd: deployRoot(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.unref()
  }, RESTART_DELAY_MS)

  return restartCommand ? 'command' : 'exit'
}
