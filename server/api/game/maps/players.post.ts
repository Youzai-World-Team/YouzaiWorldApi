import { requireGameApiKey, uploadGameMapPlayers } from '../../../utils/db'
import { parseMapPlayers } from '../../../utils/game-map-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  return uploadGameMapPlayers(parseMapPlayers(await readBody<unknown>(event)))
})
