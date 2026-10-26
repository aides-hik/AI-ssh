// Progressive enhancement only: navigation, downloads and every demo panel are readable without JS.
const navToggle = document.querySelector('[data-nav-toggle]')
const navMenu = document.querySelector('[data-nav-menu]')

if (navToggle && navMenu && navToggle.getAttribute('aria-controls') === navMenu.id) {
  const mobile = window.matchMedia('(max-width: 760px)')
  let isOpen = false

  const renderNavigation = () => {
    navToggle.hidden = !mobile.matches
    navToggle.setAttribute('aria-expanded', String(!mobile.matches || isOpen))
    navMenu.hidden = mobile.matches && !isOpen
  }

  const closeNavigation = (restoreFocus = false) => {
    isOpen = false
    renderNavigation()
    if (restoreFocus) navToggle.focus()
  }

  navToggle.addEventListener('click', () => {
    isOpen = !isOpen
    renderNavigation()
  })

  navMenu.addEventListener('click', event => {
    if (mobile.matches && event.target.closest('a[href]')) closeNavigation()
  })

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobile.matches && isOpen) {
      event.preventDefault()
      closeNavigation(true)
    }
  })

  document.addEventListener('click', event => {
    if (mobile.matches && isOpen && !navMenu.contains(event.target) && !navToggle.contains(event.target)) {
      closeNavigation()
    }
  })

  mobile.addEventListener('change', () => closeNavigation())
  renderNavigation()
}

for (const demo of document.querySelectorAll('[data-demo], [data-demo-root]')) {
  const tabs = Array.from(demo.querySelectorAll('[data-demo-tab]'))
  const panels = tabs.map(tab => document.getElementById(tab.getAttribute('aria-controls')))
  const tabList = demo.querySelector('[data-demo-tabs]') || tabs[0]?.parentElement

  // Leave the static content intact if the HTML contract is incomplete.
  if (!tabs.length || !tabList || panels.some(panel => !panel || !demo.contains(panel))) continue
  if (new Set(panels).size !== panels.length) continue

  const initialIndex = Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'))
  const selectTab = (index, focus = false) => {
    tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
      panels[tabIndex].hidden = !selected
    })
    if (focus) tabs[index].focus()
  }

  tabList.setAttribute('role', 'tablist')
  if (!tabList.hasAttribute('aria-label') && !tabList.hasAttribute('aria-labelledby')) {
    tabList.setAttribute('aria-label', '产品交互示意场景')
  }

  tabs.forEach((tab, index) => {
    tab.id ||= `${demo.id || 'prism-demo'}-tab-${index + 1}`
    tab.setAttribute('role', 'tab')
    panels[index].setAttribute('role', 'tabpanel')
    panels[index].setAttribute('aria-labelledby', tab.id)
    panels[index].tabIndex = 0

    tab.addEventListener('click', () => selectTab(index))
    tab.addEventListener('keydown', event => {
      let nextIndex
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length
      if (event.key === 'Home') nextIndex = 0
      if (event.key === 'End') nextIndex = tabs.length - 1
      if (nextIndex === undefined) return
      event.preventDefault()
      selectTab(nextIndex, true)
    })
  })

  const approve = demo.querySelector('[data-demo-approve]')
  const deployStatus = demo.querySelector('[data-demo-deploy-status]')
  const deployLog = demo.querySelector('[data-demo-deploy-log]')
  if (approve && deployStatus && deployLog) {
    approve.hidden = false
    approve.addEventListener('click', () => {
      const lines = [
        '[模拟] 操作目标：web-01，已确认当前部署阶段。',
        '[模拟] docker compose up -d → 示例服务已更新。',
        '[模拟] docker compose ps → 示例容器正在运行。',
        '[模拟] 健康检查 → 示例响应 200。',
        '以上均为预设演示结果，没有执行真实命令。'
      ]
      deployLog.replaceChildren(...lines.map(line => {
        const paragraph = document.createElement('p')
        paragraph.textContent = line
        return paragraph
      }))
      deployLog.hidden = false
      deployStatus.textContent = '模拟执行与验证完成。未连接服务器，未调用模型。'
      approve.textContent = '再次查看模拟结果'
    })
  }

  selectTab(initialIndex)
  tabList.hidden = false
  demo.dataset.enhanced = 'true'
}

// FAQ uses native details/summary. There are no network requests, timers or server commands here.
// Motion remains in CSS so prefers-reduced-motion also works before this script loads.
