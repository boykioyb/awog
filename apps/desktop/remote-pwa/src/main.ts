import { createApp } from 'vue'
import App from './App.vue'
import { gateway } from './gateway'
import { registerServiceWorker } from './pwa'
import { initStore } from './store'
import { initViewport } from './viewport'
import './style.css'

initStore()
gateway.start()
registerServiceWorker()
initViewport()

createApp(App).mount('#app')
