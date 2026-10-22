import { createApp } from 'vue'
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createRouter, createWebHashHistory } from 'vue-router'
import { createBootstrap } from 'bootstrap-vue-next/plugins/createBootstrap'

// 样式导入
import './assets/styles/main.css'

// 应用组件和路由
import App from './App.vue'
import routes from './router'

// 自定义插件
import DialogPlugin from './plugins/dialog'

// 国际化
import i18n from './locales'

// 创建应用实例
const app = createApp(App)

// 设置 Vue 错误处理器
app.config.errorHandler = (error, _instance, info) => {
  console.error(`[Vue] ${info}`, error)
}

// 创建 Pinia store
const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)

// 创建路由
const router = createRouter({
  history: createWebHashHistory(),
  routes
})

// 注册插件
app.use(pinia)
app.use(router)
app.use(i18n) // 添加国际化支持
app.use(createBootstrap())
app.use(DialogPlugin)

// 挂载应用
app.mount('#app')
