import { gameTitleWire, requireFeaturePermission, saveGameTitle } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'game-titles-catalog', 'edit')
  const body = await readBody<any>(event)
  const title = saveGameTitle({
    id: String(body?.id ?? ''),
    displayName: String(body?.display_name ?? ''),
    textContent: body?.text_content,
    textColor: body?.text_color,
    bold: body?.bold === true,
    italic: body?.italic === true,
    enabled: body?.enabled !== false,
    sortOrder: Number(body?.sort_order ?? 0),
    systemManaged: false,
  })
  return gameTitleWire(title)
})
