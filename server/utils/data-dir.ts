import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function resolveDataDir(): string {
  const fromEnv = process.env.YZWC_DATA_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)

  let dir = path.dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 12; i++) {
    if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'server'))) {
      return path.join(dir, 'server/data')
    }
    if (existsSync(path.join(dir, 'nitro.json'))) {
      return path.join(path.dirname(dir), 'server/data')
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.resolve(process.cwd(), 'server/data')
}

export const dataDir = resolveDataDir()
export const uploadsDir = path.join(dataDir, 'uploads')

export function ensureDataDirs() {
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(uploadsDir, { recursive: true })
}
