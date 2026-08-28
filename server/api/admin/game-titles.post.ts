import { gameTitleWire, requireFeaturePermission, saveGameTitle } from '../../utils/db'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'game-titles-catalog', 'edit')
  const body = await readBody<any>(event)
  const title = saveGameTitle({
    id: String(body?.id ?? ''),
    displayName: String(body?.display_name ?? ''),
    renderType: body?.render_type,
    textContent: body?.text_content,
    textColor: body?.text_color,
    bold: body?.bold === true,
    italic: body?.italic === true,
    textureKey: body?.texture_key,
    fontId: body?.font_id,
    glyph: body?.glyph,
    enabled: body?.enabled !== false,
    sortOrder: Number(body?.sort_order ?? 0),
    systemManaged: false,
  })
  return gameTitleWire(title)
})
