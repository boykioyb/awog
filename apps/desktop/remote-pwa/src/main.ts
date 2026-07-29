import { createApp } from 'vue'
import App from './App.vue'
import { gateway } from './gateway'
import { initStore } from './store'
import './style.css'

initStore()
gateway.start()

createApp(App).mount('#app')
