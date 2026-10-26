import type { SSHConfig } from '../services/ssh.service'
import type { UpdateClientState } from '../services/update-client'
import { PREVIEW_SERVERS, previewInspectionOutput, previewServer } from './servers'
import { stripCredentials } from '../utils/credential-fields'
import type { SettingsDocument } from '../services/settings-persistence'

type Listener = (...args: unknown[]) => void
interface PreviewNode {
  id: string
  type: 'connection' | 'folder'
  name: string
  host?: string
  port?: number
  username?: string
  authType?: string
  folderId?: string | null
  parentId?: string | null
  order?: number
  children?: PreviewNode[]
}
interface PreviewFile {
  name: string
  type: 'file' | 'directory'
  size: number
  modifiedTime: string
  permissions: string
}

export interface PreviewExecuteOutput {
  requestId: string
  connectionId: string
  stream: 'stdout' | 'stderr'
  data: string
  truncated?: boolean
}

/** In-memory native bridge used exclusively by vite.design.config.mts. */
export function createBrowserPreviewBridge(connectDelay = 450, executeDelay?: number) {
  const listeners = new Map<string, Set<Listener>>()
  const nodes: PreviewNode[] = PREVIEW_SERVERS.map((server, order) => ({
      id: server.id,
      type: 'connection',
      name: server.name,
      host: server.host,
      port: 22,
      username: 'demo',
      authType: 'PASSWORD',
      order
    }))
  const connections = new Map<string, SSHConfig & { id: string; nodeId: string; isConnected: boolean }>()
  const pendingExecutions = new Map<string, { connectionId: string; cancel: (reason: Error) => void }>()
  const commandFailures = new Map<string, string>()
  const commandDelays = new Map<string, number>()
  const inputs = new Map<string, string>()
  const documents = new Map<string, string>()
  let updateState: UpdateClientState = {
    enabled: true, status: 'idle', currentVersion: 'UI preview',
    statusText: '网页预览：可模拟检查更新，不会访问更新服务器。'
  }
  let updateCheck: Promise<UpdateClientState> | undefined
  const now = new Date().toISOString()
  const file = (name: string, type: 'file' | 'directory', size = 0): PreviewFile => ({
    name,
    type,
    size,
    modifiedTime: now,
    permissions: type === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--'
  })
  const initialDirectories = new Map<string, PreviewFile[]>([
    ['/', [file('home', 'directory'), file('var', 'directory')]],
    ['/home', [file('demo', 'directory')]],
    [
      '/home/demo',
      [file('projects', 'directory'), file('logs', 'directory'), file('README.md', 'file', 256)]
    ],
    ['/home/demo/projects', [file('prism-demo', 'directory')]],
    [
      '/home/demo/projects/prism-demo',
      [file('package.json', 'file', 420), file('src', 'directory')]
    ],
    ['/home/demo/projects/prism-demo/src', [file('index.ts', 'file', 128)]],
    ['/home/demo/logs', [file('app.log', 'file', 2048)]],
    ['/var', [file('log', 'directory')]],
    ['/var/log', [file('system.log', 'file', 4096)]]
  ])
  const hostDirectories = new Map<string, Map<string, PreviewFile[]>>()
  function directoriesFor(id: string) {
    let directories = hostDirectories.get(id)
    if (!directories) {
      directories = structuredClone(initialDirectories)
      hostDirectories.set(id, directories)
    }
    return directories
  }
  function on(channel: string, callback: Listener) {
    const group = listeners.get(channel) ?? new Set<Listener>()
    group.add(callback)
    listeners.set(channel, group)
    return () => {
      group.delete(callback)
      if (!group.size) listeners.delete(channel)
    }
  }
  function emit(channel: string, ...args: unknown[]) {
    for (const callback of [...(listeners.get(channel) ?? [])]) callback(...args)
  }
  function tree(parentId: string | null = null): PreviewNode[] {
    return nodes
      .filter(
        node => ((node.type === 'folder' ? node.parentId : node.folderId) ?? null) === parentId
      )
      .map(node => ({ ...node, ...(node.type === 'folder' ? { children: tree(node.id) } : {}) }))
  }
  function createNode(type: PreviewNode['type'], data: Partial<PreviewNode>) {
    const node: PreviewNode = {
      ...data,
      id: crypto.randomUUID(),
      type,
      name: data.name || '演示连接'
    }
    nodes.push(node)
    return { ...node }
  }
  function updateNode(id: string, data: Partial<PreviewNode>) {
    const node = nodes.find(item => item.id === id)
    if (!node) throw new Error('演示节点不存在')
    Object.assign(node, data, { id, type: node.type })
    return { ...node }
  }
  const promptFor = (id: string) => `\x1b[38;2;115;193;230mdemo@${previewServer(id).hostname}\x1b[0m:~$ `
  function commandOutput(id: string, command: string): string {
    const value = command.trim()
    const inspection = previewInspectionOutput(id, value)
    if (inspection !== undefined) return inspection
    if (/\bdocker\s+(?:--version|version)\b/.test(value)) return 'Docker Engine (UI preview)\nDocker Compose (UI preview)'
    if (/\bdocker\s+compose\s+ps\b/.test(value)) return `NAME                 SERVICE   STATUS\nprism-demo-${previewServer(id).hostname}   app       Up (healthy)${/\bcurl\b/.test(value) ? '\n模拟健康端点：http://127.0.0.1:8080/health\n{"status":"ok"}' : ''}\n这是网页预览的模拟检查。`
    if (/\bdocker\s+compose\s+up\s+-d\b/.test(value)) return `正在模拟拉取镜像：25%\n正在模拟拉取镜像：70%\n模拟镜像拉取完成\n正在模拟启动服务\n模拟 Compose 项目已启动：${previewServer(id).hostname}\n未执行真实命令。`
    if (/\bdocker\s+compose\s+pull\b/.test(value)) return '模拟镜像拉取完成，未执行真实命令。'
    if (/\bdocker\s+compose\s+down\b/.test(value)) return '模拟 Compose 项目已停止，未执行真实命令。'
    if (value === 'pwd') return '/home/demo'
    if (value === 'whoami') return 'demo'
    if (value === 'hostname') return previewServer(id).hostname
    if (value === 'uname -a') return `Linux ${previewServer(id).hostname} 6.12.0 x86_64 GNU/Linux (UI preview)`
    if (value === 'date') return new Date().toLocaleString()
    if (value.startsWith('ls')) return 'projects  logs  README.md'
    if (value.startsWith('cat '))
      return 'Prism UI preview — all terminal and file data are simulated.'
    if (value === 'help') return '演示命令：pwd、ls、whoami、hostname、uname -a、date、clear'
    if (!value || value === 'clear') return ''
    return '这是 UI 演示终端，不会执行真实命令。输入 help 查看演示命令。'
  }
  function requireConnection(id: string) {
    if (!connections.get(id)?.isConnected) throw new Error('演示连接已断开')
  }
  function connectionSnapshot(connection: SSHConfig & { id: string; nodeId: string; isConnected: boolean }) {
    const config: SSHConfig = { ...connection }
    delete config.password
    delete config.privateKey
    delete config.passphrase
    return { ...config, id: connection.id, nodeId: connection.nodeId, isConnected: connection.isConnected, status: connection.isConnected ? 'connected' as const : 'disconnected' as const, config: { ...config } }
  }
  function executeCommand(id: string, command: string, requestId: string = crypto.randomUUID(), options?: { timeoutMs?: number }) {
    if (options?.timeoutMs !== undefined && (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10000 || options.timeoutMs > 1800000)) {
      return Promise.reject(new Error('命令超时必须在 10 秒到 30 分钟之间'))
    }
    if (pendingExecutions.has(requestId)) return Promise.reject(new Error('执行请求已存在'))
    requireConnection(id)
    const started = Date.now()
    return new Promise<{ success: boolean; output: string; stdout: string; stderr: string; error?: string; exitCode: number; durationMs: number; truncated: boolean }>((resolve, reject) => {
      const duration = commandDelays.get(id) ?? executeDelay ?? previewServer(id).delay
      const timeoutMs = options?.timeoutMs ?? 300000
      const stdoutParts: string[] = []
      const stderrParts: string[] = []
      const timers: Array<ReturnType<typeof setTimeout>> = []
      let settled = false
      let failureSent = false
      let retainedBytes = 0
      let truncated = false
      const cleanup = () => {
        settled = true
        for (const timer of timers) clearTimeout(timer)
        pendingExecutions.delete(requestId)
      }
      const output = (stream: 'stdout' | 'stderr', value: string) => {
        if (settled || !connections.get(id)?.isConnected || !value) return
        const characters = [...value]
        let data = ''
        for (const character of characters) {
          const bytes = new TextEncoder().encode(character).length
          if (retainedBytes + bytes > 128 * 1024) { truncated = true; break }
          retainedBytes += bytes
          data += character
        }
        if (!data && !truncated) return
        if (data) (stream === 'stdout' ? stdoutParts : stderrParts).push(data)
        emit('ssh:execute-output', { requestId, connectionId: id, stream, data, truncated } satisfies PreviewExecuteOutput)
      }
      const lines = commandOutput(id, command).match(/[^\n]*\n|[^\n]+$/g) || []
      for (let index = 0; index < lines.length; index++) {
        timers.push(setTimeout(() => {
          const failure = commandFailures.get(id)
          if (failure) {
            if (!failureSent) { failureSent = true; output('stderr', failure) }
          } else if (!failureSent) output('stdout', lines[index])
        }, duration * (index + 1) / (lines.length + 1)))
      }
      const finish = () => {
        try {
          requireConnection(id)
          const failure = duration > timeoutMs ? '模拟命令执行超时' : commandFailures.get(id)
          if (failure && !failureSent) { failureSent = true; output('stderr', failure) }
          const stdout = stdoutParts.join('')
          const stderr = stderrParts.join('')
          cleanup()
          resolve({ success: !failureSent, output: stdout, stdout, stderr, ...(failureSent ? { error: failure || stderr || '模拟命令失败' } : {}), exitCode: failureSent ? 1 : 0, durationMs: Date.now() - started, truncated })
        } catch (error) { cleanup(); reject(error) }
      }
      timers.push(setTimeout(finish, Math.min(duration, timeoutMs)))
      pendingExecutions.set(requestId, { connectionId: id, cancel(reason) { cleanup(); reject(reason) } })
    })
  }
  const cancelledTransfer = async () => {
    throw new Error('演示连接不传输真实文件')
  }
  const noop = async () => undefined
  const bridge = {
    on,
    once(channel: string, callback: Listener) {
      const off = on(channel, (...args) => {
        off()
        callback(...args)
      })
    },
    onConnectionStatusChange: (callback: Listener) => on('ssh:connection-status-changed', callback),
    onTerminalOutput: (callback: Listener) => on('ssh:terminal-output', callback),
    onWindowStateChange: (callback: Listener) => on('window:state-changed', callback),
    onFullscreenChange: (callback: Listener) => on('window:fullscreen-changed', callback),
    onStatusUpdate: (callback: Listener) => on('status:update', callback),
    onNotification: (callback: Listener) => on('notification:received', callback),
    onUpdaterStateChange: (callback: (state: UpdateClientState) => void) => on('updater:state-changed', state => callback(state as UpdateClientState)),
    onMenuAction: (action: string, callback: Listener) => on(`menu:${action}`, callback),
    minimizeWindow: noop,
    maximizeWindow: noop,
    closeWindow: noop,
    quit: noop,
    toggleFullscreen: noop,
    toggleDevTools: async () => false,
    getVersion: async () => 'UI preview',
    getSystemInfo: async () => null,
    updater: {
      getState: async () => ({ ...updateState }),
      startBackgroundCheck: () => {
        if (updateCheck) return updateCheck
        updateState = { ...updateState, status: 'checking', statusText: '网页预览：正在模拟检查更新…' }
        emit('updater:state-changed', { ...updateState })
        updateCheck = new Promise(resolve => setTimeout(() => {
          updateState = { ...updateState, status: 'up-to-date', lastCheckedAt: new Date().toISOString(), statusText: '网页预览：模拟检查完成。请在桌面应用中检查真实更新。' }
          emit('updater:state-changed', { ...updateState })
          updateCheck = undefined
          resolve({ ...updateState })
        }, 1200))
        return updateCheck
      },
      installDownloadedUpdate: async () => false
    },
    preview: {
      setCommandFailure(id: string, message: string | null) {
        if (message === null) commandFailures.delete(id)
        else commandFailures.set(id, message)
      },
      setExecuteDelay(id: string, milliseconds: number) {
        commandDelays.set(id, Math.max(0, Math.min(30000, milliseconds)))
      },
      pendingCommands: () => [...pendingExecutions.entries()].map(([requestId, execution]) => ({ requestId, connectionId: execution.connectionId }))
    },
    ssh: {
      getTree: async () => tree(),
      createFolder: async (_user: string, data: Partial<PreviewNode>) => createNode('folder', data),
      createConnection: async (_user: string, data: Partial<PreviewNode>) =>
        createNode('connection', data),
      updateFolder: async (_user: string, id: string, data: Partial<PreviewNode>) =>
        updateNode(id, data),
      updateConnection: async (_user: string, id: string, data: Partial<PreviewNode>) =>
        updateNode(id, data),
      async deleteConnection(_user: string, id: string) {
        await bridge.ssh.disconnect(id)
        const index = nodes.findIndex(node => node.id === id)
        if (index >= 0) nodes.splice(index, 1)
      },
      async deleteFolder(_user: string, id: string) {
        const children = nodes.filter(node => node.folderId === id || node.parentId === id)
        for (const child of children) {
          if (child.type === 'folder') await bridge.ssh.deleteFolder(_user, child.id)
          else await bridge.ssh.deleteConnection(_user, child.id)
        }
        const index = nodes.findIndex(node => node.id === id)
        if (index >= 0) nodes.splice(index, 1)
      },
      async moveNode(data: {
        nodeId: string
        targetParentId?: string | null
        targetFolderId?: string | null
        order?: number
      }) {
        const node = nodes.find(item => item.id === data.nodeId)
        if (node)
          Object.assign(node, {
            parentId: data.targetParentId,
            folderId: data.targetFolderId,
            order: data.order
          })
      },
      exportConnections: async () => ({ canceled: true }),
      importConnections: async () => ({ canceled: true }),
      async connect(config: SSHConfig) {
        const id = config.id || 'preview-server'
        if (!connections.get(id)?.isConnected && connectDelay > 0)
          await new Promise(resolve => setTimeout(resolve, connectDelay))
        const node = nodes.find(node => node.id === id)
        const connection = { ...config, name: config.name || node?.name || config.host, id, nodeId: id, isConnected: true }
        connections.set(id, connection)
        emit('ssh:connection-status-changed', connectionSnapshot(connection))
        return connectionSnapshot(connection)
      },
      async disconnect(id: string) {
        const connection = connections.get(id)
        if (connection) connection.isConnected = false
        for (const execution of [...pendingExecutions.values()]) {
          if (execution.connectionId === id) execution.cancel(new Error('演示连接已断开'))
        }
        inputs.delete(id)
        emit('ssh:connection-status-changed', connection ? connectionSnapshot(connection) : { id, status: 'disconnected' })
      },
      getConnections: async () =>
        Array.from(connections.values(), connectionSnapshot),
      getInitialOutput: async (id: string) => {
        requireConnection(id)
        return (
          '\x1b[1;36mPrism · UI 演示终端\x1b[0m\r\n这是模拟会话，可测试终端、文件和导航动效。\r\n输入 help 查看演示命令。\r\n\r\n' +
          promptFor(id)
        )
      },
      resize: noop,
      async write(id: string, data: string) {
        requireConnection(id)
        let input = inputs.get(id) || ''
        // Ignore terminal cursor sequences rather than echoing them as command text.
        // eslint-disable-next-line no-control-regex
        for (const character of data.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')) {
          if (character === '\r' || character === '\n') {
            const output = commandOutput(id, input)
            emit(
              `ssh:output:${id}`,
              (input.trim() === 'clear' ? '\x1b[2J\x1b[H' : '\r\n') +
                output +
                (output ? '\r\n' : '') +
                promptFor(id)
            )
            input = ''
          } else if (character === '\x7f' || character === '\b') {
            if (input.length) {
              input = input.slice(0, -1)
              emit(`ssh:output:${id}`, '\b \b')
            }
          } else if (character === '\x03') {
            input = ''
            emit(`ssh:output:${id}`, '^C\r\n' + promptFor(id))
          } else if (character >= ' ') {
            input += character
            emit(`ssh:output:${id}`, character)
          }
        }
        inputs.set(id, input)
      },
      execute: executeCommand,
      onExecuteOutput: (callback: (event: PreviewExecuteOutput) => void) => on('ssh:execute-output', event => callback(event as PreviewExecuteOutput)),
      async executeSilent(id: string, command: string) {
        requireConnection(id)
        return { success: true, output: commandOutput(id, command) }
      },
      cancelExecute: async (requestId: string) => {
        const execution = pendingExecutions.get(requestId)
        if (!execution) return false
        const error = new Error('Command aborted')
        error.name = 'AbortError'
        execution.cancel(error)
        return true
      },
      getCurrentDirectory: async () => ({ success: true, output: '/home/demo' }),
      testConnection: async () => ({ success: true, message: '演示连接可用（模拟数据）' }),
      saveConnection: async (config: SSHConfig) => ({ ...config }),
      readEnvDoc: async (id: string) => {
        requireConnection(id)
        const server = previewServer(id)
        return { content: documents.get(`env/${id}`) ?? `# ${server.name}\n\n这是网页预览的模拟环境文档。\n\n- 主机：${server.host}\n- 角色：${server.role}\n- 系统：Ubuntu 24.04.3 LTS\n- 数据为模拟数据，不代表真实服务器。`, fullPath: '/home/demo/env.md' }
      },
      writeEnvDoc: async (id: string, content: string) => {
        requireConnection(id)
        documents.set(`env/${id}`, content)
        return { content, fullPath: '/home/demo/env.md' }
      },
      async listFiles(id: string, path: string) {
        requireConnection(id)
        return {
          success: true,
          files: structuredClone(directoriesFor(id).get(path.replace(/\/$/, '') || '/') ?? [])
        }
      },
      async createDirectory(id: string, path: string) {
        requireConnection(id)
        const directories = directoriesFor(id)
        const split = path.lastIndexOf('/')
        const parent = path.slice(0, split) || '/'
        const entries = directories.get(parent)
        if (!entries) throw new Error('演示目录不存在')
        entries.push(file(path.slice(split + 1), 'directory'))
        directories.set(path, [])
        return { success: true }
      },
      async deleteFile(id: string, path: string) {
        requireConnection(id)
        const directories = directoriesFor(id)
        const split = path.lastIndexOf('/')
        const entries = directories.get(path.slice(0, split) || '/')
        const index = entries?.findIndex(entry => entry.name === path.slice(split + 1)) ?? -1
        if (entries && index >= 0) entries.splice(index, 1)
        directories.delete(path)
        return { success: true }
      },
      uploadFile: cancelledTransfer,
      downloadFile: cancelledTransfer
    },
    // This memory-only adapter is loaded exclusively by the preview entry.
    // It never claims to provide the desktop's OS-backed credential storage.
    settings: (() => {
      let saved: SettingsDocument = { aiProviders: [], theme: 'dark', language: 'zh-CN' }
      return {
        get: async () => structuredClone(saved),
        save: async (_userId: string, settings: SettingsDocument) => {
          saved = structuredClone(settings)
          return { success: true }
        },
        reset: async () => {
          saved = { aiProviders: [], theme: 'dark', language: 'zh-CN' }
          return { success: true }
        },
        export: async (_userId: string, filename: string) => {
          documents.set(`settings/${filename}`, JSON.stringify(stripCredentials(saved), null, 2))
          return { success: true }
        },
        import: async (_userId: string, filename: string) => {
          const serialized = documents.get(`settings/${filename}`)
          if (!serialized) throw new Error('网页预览中找不到该设置文件。')
          saved = JSON.parse(serialized)
          return { success: true, settings: structuredClone(saved) }
        }
      }
    })(),
    fs: { showOpenDialog: async () => [], showSaveDialog: async () => null },
    docStorage: {
      save: async (category: string, name: string, content: string) => {
        documents.set(`${category}/${name}`, content)
        return { content, fullPath: `/preview/${category}/${name}` }
      },
      read: async (category: string, name: string) => {
        const content = documents.get(`${category}/${name}`)
        return content === undefined ? null : { content, fullPath: `/preview/${category}/${name}` }
      },
      list: async () => [],
      exists: async () => false,
      delete: async (category: string, name: string) => documents.delete(`${category}/${name}`)
    }
  }
  return bridge
}

export function installBrowserPreviewBridge() {
  if (window.electronAPI) return
  // This adapter deliberately implements only previewable native capabilities.
  window.electronAPI = createBrowserPreviewBridge() as unknown as Window['electronAPI']
}
