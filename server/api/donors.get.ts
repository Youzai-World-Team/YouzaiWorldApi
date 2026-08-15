interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
}

export default defineEventHandler(async () => {
  const donors = await readJson<Donor[]>('donors.json', [])
  return donors
})
