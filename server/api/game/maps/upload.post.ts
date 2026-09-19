import { requireGameApiKey, uploadGameMap } from '../../../utils/db'
import { parseMapUpload } from '../../../utils/game-map-input'

export default defineEventHandler(async (event) => {
  requireGameApiKey(event)
  return uploadGameMap(parseMapUpload(await readBody<unknown>(event)))
})
