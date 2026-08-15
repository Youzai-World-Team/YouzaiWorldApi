interface Ban {
  id: string
  player: string
  banTime: string
  unbanTime: string
  reason: string
}

export default defineEventHandler(async () => {
  const bans = await readJson<Ban[]>('bans.json', [])
  return bans
})