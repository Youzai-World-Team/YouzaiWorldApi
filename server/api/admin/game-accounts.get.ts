import { gameAccountWire, listGameAccounts, requireAuth } from '../../utils/db'

export default defineEventHandler((event) => {
  requireAuth(event)
  return listGameAccounts().map(gameAccountWire)
})
