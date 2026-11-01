import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { SFTPWrapper, Stats } from 'ssh2'
import { atomicFileTransfer, type AtomicFileTransferOptions } from './atomic-file-transfer'

interface RemoteFile { data: Buffer; mode: number; mtime: number }

function memorySftp(initial: Record<string, string | Buffer> = {}, atomicReplace = true) {
  const files = new Map<string, RemoteFile>(Object.entries(initial).map(([name, data]) => [name, {
    data: Buffer.from(data), mode: 0o100640, mtime: 1
  }]))
  const handles = new Map<string, string>()
  const operations: Array<{ name: string; target: string; flags?: string }> = []
  let nextHandle = 0
  let beforeOperation: ((name: string, target: string) => void) | undefined
  const failure = (message = 'No such file') => Object.assign(new Error(message), { code: 2 })
  const attributes = (file: RemoteFile): Stats => ({
    size: file.data.length, mode: file.mode, mtime: file.mtime, atime: 1, uid: 1, gid: 1,
    isFile: () => (file.mode & 0o170000) === 0o100000,
    isDirectory: () => false, isBlockDevice: () => false, isCharacterDevice: () => false,
    isSymbolicLink: () => false, isFIFO: () => false, isSocket: () => false
  })
  const run = (name: string, target: string, callback: (error?: Error | null, value?: unknown) => void, action: () => unknown) => {
    operations.push({ name, target })
    queueMicrotask(() => {
      try {
        beforeOperation?.(name, target)
        const value = action()
        callback(undefined, value)
      } catch (error) { callback(error as Error) }
    })
  }
  const fixture = {
    _extensions: atomicReplace ? { 'posix-rename@openssh.com': '1' } : {},
    lstat(target: string, callback: (error?: Error | null, value?: unknown) => void) {
      run('lstat', target, callback, () => {
        const file = files.get(target)
        if (!file) throw failure()
        return attributes(file)
      })
    },
    open(target: string, flags: string, attrsOrCallback: unknown, maybeCallback?: (error?: Error | null, value?: unknown) => void) {
      const callback = (typeof attrsOrCallback === 'function' ? attrsOrCallback : maybeCallback) as (error?: Error | null, value?: unknown) => void
      run('open', target, callback, () => {
        operations.at(-1)!.flags = flags
        if (flags === 'wx') {
          if (files.has(target)) throw Object.assign(new Error('Exists'), { code: 4 })
          const mode = (attrsOrCallback as { mode: number }).mode
          files.set(target, { data: Buffer.alloc(0), mode: mode | 0o100000, mtime: 1 })
        } else if (flags !== 'r' || !files.has(target)) throw failure()
        const handle = Buffer.from(String(nextHandle++))
        handles.set(handle.toString(), target)
        return handle
      })
    },
    fstat(handle: Buffer, callback: (error?: Error | null, value?: unknown) => void) {
      const target = handles.get(handle.toString())!
      run('fstat', target, callback, () => attributes(files.get(target)!))
    },
    write(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error | null, value?: unknown) => void) {
      const target = handles.get(handle.toString())!
      run('write', target, callback, () => {
        const file = files.get(target)!
        const next = Buffer.alloc(Math.max(file.data.length, position + length))
        file.data.copy(next)
        buffer.copy(next, position, offset, offset + length)
        file.data = next
      })
    },
    read(handle: Buffer, buffer: Buffer, offset: number, length: number, position: number, callback: (error?: Error | null, value?: unknown) => void) {
      const target = handles.get(handle.toString())!
      run('read', target, callback, () => files.get(target)!.data.copy(buffer, offset, position, position + length))
    },
    close(handle: Buffer, callback: (error?: Error | null, value?: unknown) => void) {
      run('close', handles.get(handle.toString())!, callback, () => { handles.delete(handle.toString()) })
    },
    unlink(target: string, callback: (error?: Error | null, value?: unknown) => void) {
      run('unlink', target, callback, () => {
        if (!files.delete(target)) throw failure()
      })
    },
    rename(from: string, to: string, callback: (error?: Error | null, value?: unknown) => void) {
      run('rename', from, callback, () => {
        if (files.has(to)) throw new Error('Target exists')
        files.set(to, files.get(from)!)
        files.delete(from)
      })
    },
    ext_openssh_rename(from: string, to: string, callback: (error?: Error | null, value?: unknown) => void) {
      run('replace', from, callback, () => {
        files.set(to, files.get(from)!)
        files.delete(from)
      })
    }
  }
  return {
    sftp: fixture as unknown as SFTPWrapper, files, handles, operations,
    hook: (callback: typeof beforeOperation) => { beforeOperation = callback }
  }
}

async function directory(t: { after: (callback: () => Promise<unknown>) => void }) {
  const parent = await fs.realpath(tmpdir())
  const root = await fs.mkdtemp(path.join(parent, 'prism-atomic-transfer-'))
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(parent))
    assert.match(path.basename(root), /^prism-atomic-transfer-/)
    await fs.rm(root, { recursive: true, force: true })
  })
  return root
}

function options(sftp: SFTPWrapper, localPath: string, overrides: Partial<AtomicFileTransferOptions> = {}): AtomicFileTransferOptions {
  return {
    sftp, localPath, remotePath: '/app/config.json', direction: 'upload',
    signal: new AbortController().signal, approveOverwrite: async () => true,
    beginCommit() {}, onProgress() {}, ...overrides
  }
}

test('upload exclusively stages beside the target and replaces only after explicit approval and size validation', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  const bytes = Buffer.alloc(700000, 'u')
  await fs.writeFile(source, bytes)
  const remote = memorySftp({ '/app/config.json': 'original' })
  let approved = false
  let commits = 0
  const progress: number[] = []
  remote.hook((name, target) => {
    if (name === 'write') {
      assert.equal(approved, true)
      assert.notEqual(target, '/app/config.json')
      assert.equal(remote.files.get('/app/config.json')!.data.toString(), 'original')
    }
  })
  await atomicFileTransfer(options(remote.sftp, source, {
    approveOverwrite: async target => { assert.equal(target, '/app/config.json'); approved = true; return true },
    beginCommit: () => { commits++ }, onProgress: count => progress.push(count)
  }))
  assert.deepEqual(remote.files.get('/app/config.json')!.data, bytes)
  assert.equal(remote.files.get('/app/config.json')!.mode & 0o777, 0o640)
  assert.equal(commits, 1)
  assert.equal(progress.at(-1), bytes.length)
  assert.equal(remote.files.size, 1)
  assert.equal(remote.handles.size, 0)
  assert(remote.operations.some(operation => operation.name === 'open' && operation.flags === 'wx'))
  assert(remote.operations.some(operation => operation.name === 'replace'))
  assert(!remote.operations.some(operation => operation.name === 'unlink' && operation.target === '/app/config.json'))
})

test('declining an overwrite or using a server without atomic replacement preserves the original without starting a copy', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, 'new')
  for (const extension of [true, false]) {
    const remote = memorySftp({ '/app/config.json': 'original' }, extension)
    let asked = 0
    await assert.rejects(atomicFileTransfer(options(remote.sftp, source, {
      approveOverwrite: async () => { asked++; return false }
    })), extension ? { name: 'AbortError' } : /不支持安全的原子覆盖/)
    assert.equal(asked, extension ? 1 : 0)
    assert.equal(remote.files.get('/app/config.json')!.data.toString(), 'original')
    assert.equal(remote.files.size, 1)
    assert(!remote.operations.some(operation => operation.name === 'open'))
  }
})

test('upload cancellation while writing cleans its temporary file and preserves the previous target', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, Buffer.alloc(600000, 'n'))
  const remote = memorySftp({ '/app/config.json': 'original' })
  const controller = new AbortController()
  let commits = 0
  remote.hook(name => { if (name === 'write') controller.abort() })
  await assert.rejects(atomicFileTransfer(options(remote.sftp, source, {
    signal: controller.signal, beginCommit: () => { commits++ }
  })), { name: 'AbortError' })
  assert.equal(commits, 0)
  assert.deepEqual([...remote.files.keys()], ['/app/config.json'])
  assert.equal(remote.files.get('/app/config.json')!.data.toString(), 'original')
  assert.equal(remote.handles.size, 0)
})

test('disk failure and corrupted upload sizes never replace the target', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, 'new contents')
  for (const failure of ['disk-full', 'wrong-size']) {
    const remote = memorySftp({ '/app/config.json': 'original' })
    remote.hook((name, target) => {
      if (name === 'write' && failure === 'disk-full') throw new Error('No space left on device')
      if (name === 'fstat' && failure === 'wrong-size') remote.files.get(target)!.data = Buffer.alloc(1)
    })
    await assert.rejects(atomicFileTransfer(options(remote.sftp, source)), failure === 'disk-full' ? /No space/ : /大小不一致/)
    assert.deepEqual([...remote.files.keys()], ['/app/config.json'])
    assert.equal(remote.files.get('/app/config.json')!.data.toString(), 'original')
  }
})

test('an upload never silently overwrites a target that appeared during staging', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, 'our content')
  const remote = memorySftp()
  remote.hook(name => {
    if (name === 'write') remote.files.set('/app/config.json', { data: Buffer.from('someone else'), mode: 0o100600, mtime: 2 })
  })
  await assert.rejects(atomicFileTransfer(options(remote.sftp, source)), /目标在传输期间发生变化/)
  assert.equal(remote.files.get('/app/config.json')!.data.toString(), 'someone else')
  assert.equal(remote.files.size, 1)
})

test('empty uploads work without an atomic-replace extension when creating a new target', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, '')
  const remote = memorySftp({}, false)
  await atomicFileTransfer(options(remote.sftp, source))
  assert.equal(remote.files.get('/app/config.json')!.data.length, 0)
  assert.equal(remote.files.get('/app/config.json')!.mode & 0o777, 0o600)
  assert.equal(remote.files.size, 1)
  assert(remote.operations.some(operation => operation.name === 'rename'))
})

test('downloads stage in a local exclusive file and preserve the original on cancellation or a read failure', async t => {
  const root = await directory(t)
  const target = path.join(root, 'target')
  for (const failure of ['abort', 'read-error']) {
    await fs.writeFile(target, 'original')
    const remote = memorySftp({ '/app/config.json': Buffer.alloc(700000, 'd') })
    const controller = new AbortController()
    remote.hook(name => {
      if (name === 'read') {
        if (failure === 'abort') controller.abort()
        else throw new Error('Remote read failed')
      }
    })
    await assert.rejects(atomicFileTransfer(options(remote.sftp, target, { direction: 'download', signal: controller.signal })), failure === 'abort' ? { name: 'AbortError' } : /Remote read failed/)
    assert.equal(await fs.readFile(target, 'utf8'), 'original')
    assert.deepEqual(await fs.readdir(root), ['target'])
    assert.equal(remote.handles.size, 0)
  }
})

test('downloads ask before replacing a file and complete new, existing and zero-byte targets', async t => {
  const root = await directory(t)
  for (const existing of [false, true]) {
    for (const bytes of [Buffer.alloc(0), Buffer.alloc(700000, 'd')]) {
      const target = path.join(root, `${existing}-${bytes.length}`)
      if (existing) await fs.writeFile(target, 'original', { mode: 0o640 })
      const remote = memorySftp({ '/app/config.json': bytes })
      let asked = 0
      await atomicFileTransfer(options(remote.sftp, target, {
        direction: 'download', approveOverwrite: async () => { asked++; return true }
      }))
      assert.equal(asked, existing ? 1 : 0)
      assert.deepEqual(await fs.readFile(target), bytes)
      assert.equal(remote.handles.size, 0)
    }
  }
  assert(!(await fs.readdir(root)).some(name => name.endsWith('.part')))
})

test('a local target created during download is preserved instead of being overwritten', async t => {
  const root = await directory(t)
  const target = path.join(root, 'target')
  const remote = memorySftp({ '/app/config.json': 'new content' })
  let created: Promise<void> | undefined
  remote.hook(name => { if (name === 'read') created = fs.writeFile(target, 'someone else') })
  await assert.rejects(atomicFileTransfer(options(remote.sftp, target, {
    direction: 'download', onProgress: () => {}, beginCommit: () => assert.fail('A changed target cannot be committed')
  })), /目标在下载期间发生变化/)
  await created
  assert.equal(await fs.readFile(target, 'utf8'), 'someone else')
  assert.deepEqual(await fs.readdir(root), ['target'])
})

test('cancellation before readiness and after a delayed remote OPEN does not leave an owned temporary file', async t => {
  const root = await directory(t)
  const source = path.join(root, 'source')
  await fs.writeFile(source, 'new content')
  const remote = memorySftp()
  const controller = new AbortController()
  remote.hook(name => { if (name === 'open') controller.abort() })
  await assert.rejects(atomicFileTransfer(options(remote.sftp, source, { signal: controller.signal })), { name: 'AbortError' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(remote.files.size, 0)
  assert.equal(remote.handles.size, 0)
})

test('unsupported local storage and a target appearing at commit fail clearly without an unsafe replacement fallback', async t => {
  const root = await directory(t)
  const target = path.join(root, 'target')
  for (const code of ['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'EPERM', 'EEXIST']) {
    const remote = memorySftp({ '/app/config.json': 'new content' })
    const link = t.mock.method(fs, 'link', async () => { throw Object.assign(new Error('synthetic storage failure'), { code }) })
    await assert.rejects(atomicFileTransfer(options(remote.sftp, target, { direction: 'download' })), code === 'EEXIST' ? /目标在下载期间发生变化/ : /目标存储不支持安全保存/)
    link.mock.restore()
    assert.deepEqual(await fs.readdir(root), [])
    assert.equal(remote.handles.size, 0)
  }
})

test('progress observers cannot turn a committed upload or download into a failed transfer', async t => {
  const root = await directory(t)
  for (const direction of ['upload', 'download'] as const) {
    const localPath = path.join(root, direction)
    await fs.writeFile(localPath, direction === 'upload' ? 'new payload' : 'original')
    const remote = memorySftp({ '/app/config.json': direction === 'download' ? 'new payload' : 'original' })
    let commits = 0
    await atomicFileTransfer(options(remote.sftp, localPath, {
      direction, beginCommit: () => { commits++ },
      onProgress: () => { throw new Error('Renderer was destroyed') }
    }))
    assert.equal(commits, 1)
    assert.equal(direction === 'upload' ? remote.files.get('/app/config.json')?.data.toString() : await fs.readFile(localPath, 'utf8'), 'new payload')
    assert.equal(remote.handles.size, 0)
  }
})

test('local permission or change-time updates during staging stop an approved replacement', async t => {
  const root = await directory(t)
  const target = path.join(root, 'target')
  const lstat = fs.lstat.bind(fs)
  for (const changed of ['mode', 'ctimeMs'] as const) {
    await fs.writeFile(target, 'original')
    let reads = 0
    const mocked = t.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
      const result = await lstat(...args)
      if (args[0] === target && ++reads === 2) {
        return Object.assign(Object.create(Object.getPrototypeOf(result)), result, {
          [changed]: changed === 'mode' ? Number(result.mode) ^ 0o200 : Number(result.ctimeMs) + 10
        })
      }
      return result
    })
    const remote = memorySftp({ '/app/config.json': 'new payload' })
    await assert.rejects(atomicFileTransfer(options(remote.sftp, target, {
      direction: 'download', beginCommit: () => assert.fail('A changed target must not be committed')
    })), /本地目标在下载期间发生变化/)
    mocked.mock.restore()
    assert.equal(await fs.readFile(target, 'utf8'), 'original')
    assert.deepEqual(await fs.readdir(root), ['target'])
  }
})

test('cancellation after the final commit boundary preserves the actual successful outcome', async t => {
  const root = await directory(t)
  for (const direction of ['upload', 'download'] as const) {
    const localPath = path.join(root, direction)
    await fs.writeFile(localPath, direction === 'upload' ? 'new payload' : 'original')
    const remote = memorySftp({ '/app/config.json': direction === 'download' ? 'new payload' : 'original' })
    const controller = new AbortController()
    await atomicFileTransfer(options(remote.sftp, localPath, {
      direction, signal: controller.signal, beginCommit: () => controller.abort()
    }))
    assert.equal(direction === 'upload' ? remote.files.get('/app/config.json')?.data.toString() : await fs.readFile(localPath, 'utf8'), 'new payload')
    assert.equal(remote.handles.size, 0)
  }
})
