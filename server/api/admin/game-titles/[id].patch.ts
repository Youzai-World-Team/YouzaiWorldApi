import { createError } from 'h3'
import { gameTitleWire, getGameTitle, requireFeaturePermission, saveGameTitle } from '../../../utils/db'

export default defineEventHandler(async (event) => {
  requireFeaturePermission(event, 'game-titles-catalog', 'edit')
  const id = String(getRouterParam(event, 'id') ?? '').trim().toLocaleLowerCase('en-US')
  const current = getGameTitle(id)
  if (!current) throw createError({ statusCode: 404, statusMessage: '称号不存在' })
  const body = await readBody<any>(event)
  const title = saveGameTitle({
    ...current,
    displayName: body?.display_name === undefined ? current.displayName : String(body.display_name),
    renderType: body?.render_type ?? current.renderType,
    textContent: body?.text_content ?? current.textContent,
    textColor: body?.text_color ?? current.textColor,
    bold: body?.bold === undefined ? current.bold : body.bold === true,
    italic: body?.italic === undefined ? current.italic : body.italic === true,
    textureKey: body?.texture_key ?? current.textureKey,
    fontId: body?.font_id ?? current.fontId,
    glyph: body?.glyph ?? current.glyph,
    enabled: body?.enabled === undefined ? current.enabled : body.enabled === true,
    sortOrder: body?.sort_order === undefined ? current.sortOrder : Number(body.sort_order),
  })
  return gameTitleWire(title)
})
