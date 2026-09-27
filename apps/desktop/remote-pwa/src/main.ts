import { createApp } from 'vue'
import App from './App.vue'
import { installDemoGateway } from './demo'
import { gateway } from './gateway'
import { registerServiceWorker } from './pwa'
import { initStore } from './store'
import { initViewport } from './viewport'
import './style.css'

// `?demo` trong dev: cắm gateway giả, không mở socket. `import.meta.env.DEV`
// gấp thành `false` ở production build → cả nhánh lẫn module demo bị
// tree-shake hết, không vào bundle.
const demo = import.meta.env.DEV && new URLSearchParams(location.search).has('demo')
if (demo) installDemoGateway()
initStore()
if (!demo) gateway.start()
registerServiceWorker()
initViewport()

createApp(App).mount('#app')
