interface Activity {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  date: string
  content: string
}

export default defineEventHandler(async () => {
  const items = await readJson<Activity[]>('activities.json', [])
  return items
})
