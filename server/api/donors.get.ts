interface Donor {
  id: string
  avatar: string
  name: string
  intro: string
  amount: number
}

export default defineEventHandler(async () => {
  const donors = await readJson<Array<Donor & { amount?: number }>>('donors.json', [])
  return donors.map((d) => ({ ...d, amount: typeof d.amount === 'number' ? d.amount : 0 }))
})
