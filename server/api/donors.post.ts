export default defineEventHandler(async (event) => {
  requireAuth(event)

  const body = await readBody<{ avatar?: string; name?: string; intro?: string; amount?: number | string }>(event)

  if (!body.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({ statusCode: 400, statusMessage: '名称不能为空' })
  }

  const rawAmount = Number(body.amount)
  const amount = Number.isFinite(rawAmount) && rawAmount >= 0 ? Math.round(rawAmount * 100) / 100 : 0

  const donor = {
    id: `donor_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    avatar: typeof body.avatar === 'string' ? body.avatar : '',
    name: body.name.trim(),
    intro: typeof body.intro === 'string' ? body.intro.trim() : '',
    amount,
  }
  insertDonor(donor)

  return donor
})
