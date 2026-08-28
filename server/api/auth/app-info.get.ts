import { requireAuth } from '../../utils/db'
import { getLastDeploymentTime } from '../../utils/deploy'

const APP_VERSION = 'Beta 2.5.4'
const REPOSITORY_URL = 'https://github.com/Youzai-World-Team/YouzaiWorldApi'
const CONTRIBUTORS = ['a彬彬a', 'Csituka_D']

export default defineEventHandler(async (event) => {
  requireAuth(event)
  return {
    version: APP_VERSION,
    deployedAt: await getLastDeploymentTime(),
    contributors: CONTRIBUTORS,
    repository: {
      name: 'YouzaiWorldApi',
      url: REPOSITORY_URL,
    },
  }
})
