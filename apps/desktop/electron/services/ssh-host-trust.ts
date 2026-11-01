import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Client, type ConnectConfig, type SyncHostVerifier } from 'ssh2'

export interface SSHHostIdentity {
  host: string
  port: number
  keyType: string
  fingerprint: string
}

interface TrustedHost extends SSHHostIdentity {
  trustedAt: string
}

interface KnownHosts {
  version: 1
  hosts: TrustedHost[]
}

export interface SSHHostTrustQuestion extends SSHHostIdentity {
  kind: 'unknown' | 'changed' | 'replace'
  previousFingerprint?: string
}

export interface SSHHostTrustOptions {
  filePath: () => string
  ask: (question: SSHHostTrustQuestion) => Promise<boolean>
  /** The probe never receives authentication credentials. */
  probe?: (endpoint: Pick<SSHHostIdentity, 'host' | 'port'>, timeoutMs: number) => Promise<Buffer>
}

export function normalizeSSHHost(host: unknown, port: unknown = 22) {
  if (typeof host !== 'string') throw new Error('SSH 主机地址无效。')
  let normalized = host.trim().toLowerCase().replace(/\.$/, '')
  if (normalized.startsWith('[') && normalized.endsWith(']')) normalized = normalized.slice(1, -1)
  const hasControlCharacter = [...normalized].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
  if (!normalized || hasControlCharacter || /[\s/\\?#@]/.test(normalized)) throw new Error('SSH 主机地址无效。')
  if (normalized.includes(':')) {
    try { normalized = new URL(`http://[${normalized}]/`).hostname.slice(1, -1) }
    catch { throw new Error('SSH 主机地址无效。') }
  }
  const normalizedPort = port === undefined ? 22 : Number(port)
  if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
    throw new Error('SSH 端口无效。')
  }
  return { host: normalized, port: normalizedPort }
}

export function sshHostFingerprint(key: Buffer): Pick<SSHHostIdentity, 'keyType' | 'fingerprint'> {
  if (!Buffer.isBuffer(key) || key.length < 5 || key.length > 1024 * 1024) {
    throw new Error('SSH 服务器公钥格式无效。')
  }
  const typeLength = key.readUInt32BE(0)
  if (!typeLength || typeLength > 128 || typeLength + 4 >= key.length) {
    throw new Error('SSH 服务器公钥格式无效。')
  }
  const keyType = key.subarray(4, 4 + typeLength).toString('ascii')
  if (!/^[A-Za-z0-9@._+-]+$/.test(keyType)) throw new Error('SSH 服务器公钥格式无效。')
  return { keyType, fingerprint: `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` }
}

/** Stop at host verification, before the SSH user-authentication phase. */
export function probeSSHHostKey(endpoint: Pick<SSHHostIdentity, 'host' | 'port'>, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let discovered: Buffer | undefined
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      client.destroy()
      if (discovered) resolve(discovered)
      else reject(error || new Error('SSH 服务器未提供可验证的主机公钥。'))
    }
    const timeout = setTimeout(() => finish(new Error('读取 SSH 服务器指纹超时，请检查网络后重试。')), timeoutMs)
    client.on('error', finish)
    client.once('close', () => finish())
    try {
      client.connect({
        host: endpoint.host,
        port: endpoint.port,
        username: 'prism-host-verification',
        readyTimeout: timeoutMs,
        // No password, private key, agent or user-provided authentication handler.
        authHandler: () => false,
        hostVerifier: (key: Buffer) => {
          discovered = Buffer.from(key)
          return false
        }
      })
    } catch (error) {
      finish(error instanceof Error ? error : new Error('无法读取 SSH 服务器指纹。'))
    }
  })
}

export class SSHHostTrust {
  private readonly options: SSHHostTrustOptions
  private readonly pendingHosts = new Map<string, Promise<unknown>>()
  private pendingWrite: Promise<unknown> = Promise.resolve()

  constructor(options: SSHHostTrustOptions) {
    this.options = options
  }

  /**
   * The credential-free probe ends before prompting. Human verification therefore
   * does not consume the real connection's handshake timeout. Authentication then
   * pins that exact identity again, including every subsequent rekey.
   */
  async prepare(config: Pick<ConnectConfig, 'host' | 'port' | 'readyTimeout'>): Promise<SyncHostVerifier> {
    const endpoint = normalizeSSHHost(config.host, config.port)
    const key = JSON.stringify([endpoint.host, endpoint.port])
    const previous = this.pendingHosts.get(key) || Promise.resolve()
    const current = previous.catch(() => {}).then(() => this.prepareEndpoint(endpoint, config.readyTimeout))
    this.pendingHosts.set(key, current)
    try { return await current }
    finally { if (this.pendingHosts.get(key) === current) this.pendingHosts.delete(key) }
  }

  private async read(): Promise<KnownHosts> {
    try {
      const filename = this.options.filePath()
      const info = await fs.stat(filename)
      if (!info.isFile() || info.size > 8 * 1024 * 1024) throw new Error('Invalid known-hosts file')
      const value: unknown = JSON.parse(await fs.readFile(filename, 'utf8'))
      if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 ||
          !('hosts' in value) || !Array.isArray(value.hosts) || value.hosts.length > 25000) {
        throw new Error('Invalid known-hosts file')
      }
      const unique = new Set<string>()
      for (const host of value.hosts) {
        if (!host || typeof host !== 'object' || typeof host.host !== 'string' ||
            !Number.isInteger(host.port) || typeof host.keyType !== 'string' ||
            !/^[A-Za-z0-9@._+-]{1,128}$/.test(host.keyType) ||
            typeof host.fingerprint !== 'string' || !/^SHA256:[A-Za-z0-9+/]{43}$/.test(host.fingerprint) ||
            typeof host.trustedAt !== 'string' || !Number.isFinite(Date.parse(host.trustedAt))) {
          throw new Error('Invalid known-hosts record')
        }
        const endpoint = normalizeSSHHost(host.host, host.port)
        const key = JSON.stringify([endpoint.host, endpoint.port])
        if (host.host !== endpoint.host || unique.has(key)) throw new Error('Duplicate or noncanonical known-hosts record')
        unique.add(key)
      }
      return value as KnownHosts
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, hosts: [] }
      throw new Error('无法读取已保存的 SSH 服务器指纹。请检查存储目录中的 ssh-known-hosts.json；原记录未被覆盖。', { cause: error })
    }
  }

  private async save(identity: SSHHostIdentity, previous?: TrustedHost): Promise<void> {
    const pending = this.pendingWrite.catch(() => {}).then(async () => {
      const data = await this.read()
      const index = data.hosts.findIndex(host => host.host === identity.host && host.port === identity.port)
      const current = index === -1 ? undefined : data.hosts[index]
      if (current?.fingerprint !== previous?.fingerprint) {
        throw new Error('SSH 服务器信任记录已改变，请重新连接并核对指纹。')
      }
      const record: TrustedHost = { ...identity, trustedAt: new Date().toISOString() }
      if (index === -1) data.hosts.push(record)
      else data.hosts[index] = record
      const filename = this.options.filePath()
      const temporary = path.join(path.dirname(filename), `.ssh-known-hosts-${randomUUID()}.tmp`)
      await fs.mkdir(path.dirname(filename), { recursive: true })
      try {
        const handle = await fs.open(temporary, 'wx', 0o600)
        try {
          await handle.writeFile(JSON.stringify(data, null, 2) + '\n', 'utf8')
          await handle.sync()
        } finally { await handle.close() }
        await fs.rename(temporary, filename)
      } finally { await fs.rm(temporary, { force: true }).catch(() => {}) }
    })
    this.pendingWrite = pending
    try { await pending }
    catch (error) {
      throw new Error('未能保存 SSH 服务器指纹，已停止连接；请检查存储目录权限后重试。', { cause: error })
    }
  }

  private async prepareEndpoint(endpoint: Pick<SSHHostIdentity, 'host' | 'port'>, timeout?: number): Promise<SyncHostVerifier> {
    const known = (await this.read()).hosts.find(host => host.host === endpoint.host && host.port === endpoint.port)
    const timeoutMs = typeof timeout === 'number' && Number.isFinite(timeout) && timeout > 0
      ? Math.min(300000, Math.max(1000, timeout)) : 10000
    const rawKey = await (this.options.probe || probeSSHHostKey)(endpoint, timeoutMs)
    const identity: SSHHostIdentity = { ...endpoint, ...sshHostFingerprint(rawKey) }
    if (!known) {
      if (!await this.options.ask({ ...identity, kind: 'unknown' })) {
        throw new Error('未信任此 SSH 服务器指纹，连接已取消。')
      }
      await this.save(identity)
    } else if (known.fingerprint !== identity.fingerprint) {
      const question = { ...identity, previousFingerprint: known.fingerprint }
      if (await this.options.ask({ ...question, kind: 'changed' }) &&
          await this.options.ask({ ...question, kind: 'replace' })) {
        await this.save(identity, known)
        throw new Error('SSH 服务器密钥已变更，本次连接已阻止。已保存重新核对的新指纹，请再次连接。')
      }
      throw new Error('SSH 服务器指纹与已保存记录不一致，本次连接已阻止。请向服务器管理员核对旧、新指纹后重试。')
    }
    const expected = identity.fingerprint
    return (key: Buffer) => {
      try { return sshHostFingerprint(key).fingerprint === expected }
      catch { return false }
    }
  }
}
