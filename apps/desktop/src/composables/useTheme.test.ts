import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type FontSize = 'small' | 'medium' | 'large'
type Action = { type: 'font'; value: FontSize } | { type: 'reset' }
interface Snapshot {
  fontSize: FontSize
  colorScheme: string
  styles: Record<string, string>
  values: Record<string, string>
}
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const moduleURL = new URL('./useTheme.ts', import.meta.url).href

// Each process is a fresh application load, so initialization and restored state
// exercise the real module singleton rather than a test-only reset hook.
function appearance(initial: Record<string, string>, actions: Action[] = []): Snapshot[] {
  const code = `
    import { readFileSync } from 'node:fs';
    const { useTheme } = await import(${JSON.stringify(moduleURL)});
    const input = JSON.parse(readFileSync(0, 'utf8'));
    const values = new Map(Object.entries(input.initial));
    const styles = new Map();
    const classes = new Set();
    globalThis.localStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: key => values.delete(key)
    };
    globalThis.document = { documentElement: {
      dataset: {}, offsetWidth: 1000,
      classList: { add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name) },
      style: { setProperty: (key, value) => styles.set(key, value) }
    } };
    globalThis.window = Object.assign(new EventTarget(), {
      matchMedia: () => ({ matches: false, addEventListener() {} }),
      requestAnimationFrame: () => 1, cancelAnimationFrame() {}
    });
    const theme = useTheme();
    theme.initialize();
    const snapshot = () => ({ fontSize: theme.fontSize.value,
      colorScheme: theme.colorScheme.value, styles: Object.fromEntries(styles),
      values: Object.fromEntries(values) });
    const snapshots = [snapshot()];
    for (const action of input.actions) {
      if (action.type === 'font') theme.setFontSize(action.value);
      else if (action.type === 'reset') theme.resetToDefault();
      snapshots.push(snapshot());
    }
    process.stdout.write(JSON.stringify(snapshots));
  `
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', code], {
    cwd: repositoryRoot, encoding: 'utf8', input: JSON.stringify({ initial, actions }), timeout: 15000
  })
  assert.ifError(result.error)
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout) as Snapshot[]
}

test('all three font choices apply immediately, persist, and survive a fresh application load', () => {
  const snapshots = appearance({}, [
    { type: 'font', value: 'small' }, { type: 'font', value: 'large' }, { type: 'font', value: 'medium' }
  ])
  const expected = { small: ['0.875', '14px'], medium: ['1', '16px'], large: ['1.125', '18px'] }
  for (const snapshot of snapshots.slice(1)) {
    assert.equal(snapshot.styles['--prism-font-scale'], expected[snapshot.fontSize][0])
    assert.equal(snapshot.styles['--font-size-base'], expected[snapshot.fontSize][1])
    assert.equal(JSON.parse(snapshot.values['theme-settings']).fontSize, snapshot.fontSize)
    const [restored] = appearance(snapshot.values)
    assert.equal(restored.fontSize, snapshot.fontSize)
    assert.equal(restored.styles['--prism-font-scale'], snapshot.styles['--prism-font-scale'])
  }
})

test('current font and color preferences win over the stale app settings mirror', () => {
  const originalApp = JSON.stringify({
    appearance: { fontSize: 'small', colorScheme: 'green' },
    terminal: { fontSize: 22 }, aiProviders: [{ id: 'fixture-provider', enabled: true }]
  })
  const [snapshot] = appearance({
    'app-settings': originalApp,
    'theme-settings': JSON.stringify({ fontSize: 'large', colorScheme: 'purple' }),
    'app-theme-mode': 'light-modern'
  })
  assert.equal(snapshot.fontSize, 'large')
  assert.equal(snapshot.colorScheme, 'purple')
  assert.equal(snapshot.styles['--prism-font-scale'], '1.125')
  assert.equal(snapshot.values['app-theme-mode'], 'light-modern')
  assert.equal(snapshot.values['app-settings'], originalApp)
})

test('legacy app appearance seeds missing preferences once without changing unrelated settings', () => {
  const originalApp = JSON.stringify({
    appearance: { fontSize: 'small', colorScheme: 'orange', theme: 'dark' },
    terminal: { fontSize: 21 }, ssh: { timeout: 45 }
  })
  const [migrated] = appearance({ 'app-settings': originalApp })
  assert.equal(migrated.fontSize, 'small')
  assert.equal(migrated.colorScheme, 'orange')
  assert.equal(migrated.styles['--prism-font-scale'], '0.875')
  assert.equal(migrated.values['app-settings'], originalApp)
  assert.equal(JSON.parse(migrated.values['theme-settings']).fontSize, 'small')
  const changed = appearance(migrated.values, [{ type: 'font', value: 'large' }]).at(-1)
  assert.ok(changed)
  const [reloaded] = appearance(changed.values)
  assert.equal(reloaded.fontSize, 'large')
  assert.equal(reloaded.colorScheme, 'orange')
  assert.equal(reloaded.values['app-settings'], originalApp)
})

test('missing or invalid current fields fall back independently to valid legacy values', () => {
  const [snapshot] = appearance({
    'theme-settings': JSON.stringify({ fontSize: 'huge', colorScheme: 'purple', animations: false }),
    'app-settings': JSON.stringify({ appearance: { fontSize: 'large', colorScheme: 'orange' } })
  })
  assert.equal(snapshot.fontSize, 'large')
  assert.equal(snapshot.colorScheme, 'purple')
  assert.equal(snapshot.styles['--prism-font-scale'], '1.125')
  assert.equal(snapshot.styles['--animation-duration'], '0s')
  const [malformed] = appearance({
    'theme-settings': '{broken',
    'app-settings': JSON.stringify({ appearance: { fontSize: 'small', colorScheme: 'green' } })
  })
  assert.equal(malformed.fontSize, 'small')
  assert.equal(malformed.colorScheme, 'green')
})

test('reset restores the default font scale and the reset wins over legacy appearance on reload', () => {
  const snapshots = appearance({
    'theme-settings': JSON.stringify({ fontSize: 'large', colorScheme: 'purple' }),
    'app-settings': JSON.stringify({ appearance: { fontSize: 'small', colorScheme: 'orange' } })
  }, [{ type: 'reset' }])
  const reset = snapshots[1]
  assert.equal(reset.fontSize, 'medium')
  assert.equal(reset.colorScheme, 'blue')
  assert.equal(reset.styles['--prism-font-scale'], '1')
  const [restored] = appearance(reset.values)
  assert.equal(restored.fontSize, 'medium')
  assert.equal(restored.colorScheme, 'blue')
  assert.equal(restored.styles['--prism-font-scale'], '1')
})
