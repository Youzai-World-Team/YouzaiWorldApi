import { gameAccountWire, listGameAccounts, requireGameApiKey } from '../../utils/db'

export default defineEventHandler((event) => {
  requireGameApiKey(event)
  return { accounts: listGameAccounts().map((account) => gameAccountWire(account)) }
})
