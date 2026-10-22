import { build } from 'esbuild'
import { copy } from 'fs-extra'
import { readFile, writeFile } from 'fs/promises'
const serverPackage = JSON.parse(await readFile('package.json', 'utf8'))

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node26',
  format: 'esm',
  outfile: 'dist-bundle/index.js',
  define: {
    'process.env.APP_VERSION': JSON.stringify(serverPackage.version)
  },
  external: [
    // 原生二进制依赖不打包
    'sharp',
    '@prisma/client',
    '@prisma/adapter-pg',
    'pg',
    // Pino starts workers from its installed package; bundling breaks those paths.
    'pino',
    'pino-pretty',
    'ssh2',
    '@node-rs/*',
    'cpu-features'
  ],
  banner: {
    js: `
import { createRequire as __createRequire } from 'module';
import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __dirname_fn } from 'path';

const require = __createRequire(import.meta.url);
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __dirname_fn(__filename);
`.trim()
  },
  sourcemap: true,
  minify: false,
  treeShaking: true
})

// 复制必要文件
console.log('📁 复制 Prisma 文件...')
try {
  await copy('../database/prisma', 'dist-bundle/database/prisma')
  await copy('../database/prisma.config.ts', 'dist-bundle/database/prisma.config.ts')
  await copy('../database/package.json', 'dist-bundle/database/package.json')
  await copy('../database/dist/src/generated/client', 'dist-bundle/database/dist/src/generated/client')
  console.log('✅ Prisma 文件复制成功')
} catch (error) {
  console.error('❌ Prisma 文件复制失败:', error.message)
  throw error
}

// 创建 package.json（标记为 ESM）
console.log('📝 创建 package.json...')
await writeFile(
  'dist-bundle/package.json',
  JSON.stringify(
    {
      type: 'module',
      name: '@ai-ssh/server-bundle',
      version: serverPackage.version,
      private: true
    },
    null,
    2
  )
)

console.log('✅ Bundle 完成！')
