import { listChatMessages } from '../utils/db'

export default defineEventHandler(() => {
  return listChatMessages()
})
