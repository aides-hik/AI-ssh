import { installBrowserPreviewBridge } from './bridge'
import { installPreviewModels } from './models'
import { createPreviewModelFetch } from './model-fetch'

if (!window.electronAPI) {
  installBrowserPreviewBridge()
  installPreviewModels()
  window.fetch = createPreviewModelFetch(window.fetch.bind(window))
}
await import('../main')
