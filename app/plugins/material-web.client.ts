import '@material/web/all.js'
import '@material/web/labs/navigationdrawer/navigation-drawer.js'
import '@material/web/labs/navigationdrawer/navigation-drawer-modal.js'
import { installDialogAnimation } from '../composables/useDialogAnimation'

export default defineNuxtPlugin(() => {
  installDialogAnimation()
})
