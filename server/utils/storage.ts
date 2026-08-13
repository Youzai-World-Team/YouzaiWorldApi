import { promises as fs } from 'node:fs'
import path from 'node:path'

const dataDir = path.resolve(process.cwd(), 'server/data')

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(path.join(dataDir, file), 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export async function writeJson(file: string, data: unknown) {
  await fs.mkdir(dataDir, { recursive: true })
  await fs.writeFile(path.join(dataDir, file), JSON.stringify(data, null, 2), 'utf-8')
}

export async function ensureConfig() {
  const file = path.join(dataDir, 'config.json')
  try {
    await fs.access(file)
  } catch {
    await writeJson('config.json', { password: '123456' })
  }
}
