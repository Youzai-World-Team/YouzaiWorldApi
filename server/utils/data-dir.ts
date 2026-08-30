import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function findProjectRoot(anchors: (string | undefined)[]): string | null {
  for (const anchor of anchors) {
    if (!anchor) continue
    let dir = anchor
    for (let i = 0; i < 12; i++) {
      if (existsSync(path.join(dir, 'package.json')) && existsSync(path.join(dir, 'server'))) {
        return dir
      }
      if (existsSync(path.join(dir, 'nitro.json'))) {
        return path.dirname(dir)
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return null
}

function resolveDataDir(): string {
  const fromEnv = process.env.YZWC_DATA_DIR?.trim()
  if (fromEnv) return path.resolve(fromEnv)

  const argv1 = process.argv[1]
  const root = findProjectRoot([
    path.dirname(fileURLToPath(import.meta.url)),
    argv1 ? path.dirname(path.resolve(argv1)) : undefined,
  ])

  return root ? path.join(root, 'server/data') : path.resolve(process.cwd(), 'server/data')
}

export const dataDir = resolveDataDir()
export const uploadsDir = path.join(dataDir, 'uploads')

console.info(`[data] ${dataDir}`)

export function ensureDataDirs() {
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(uploadsDir, { recursive: true })
}
