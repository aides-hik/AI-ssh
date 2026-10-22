/**
 * electron-builder before-pack hook
 * 在打包前清理目标目录，避免硬链接冲突
 */

const fs = require('fs')
const path = require('path')

/**
 * @param {import('electron-builder').BeforePackContext} context
 */
async function beforePack(context) {
  const { electronPlatformName, appOutDir } = context
  console.log(`[before-pack] 清理打包目录: ${electronPlatformName}`)
  
  try {
    // 获取 release 目录
    const releaseDir = path.resolve(__dirname, '../release')
    const outputDir = path.resolve(appOutDir)
    const relativeOutput = path.relative(releaseDir, outputDir)
    if (!relativeOutput || relativeOutput === '..' || relativeOutput.startsWith(`..${path.sep}`) || path.isAbsolute(relativeOutput)) {
      throw new Error(`Refusing to clean output outside the desktop release directory: ${outputDir}`)
    }
    
    console.log(`[before-pack] 目标目录: ${appOutDir}`)
    console.log(`[before-pack] Release 目录: ${releaseDir}`)
    
    // 删除旧的打包输出
    if (fs.existsSync(outputDir)) {
      console.log(`[before-pack] 删除旧的输出目录...`)
      
      fs.rmSync(outputDir, { recursive: true, force: true, maxRetries: 3 })
      
      console.log(`[before-pack] ✅ 清理完成`)
    } else {
      console.log(`[before-pack] ✅ 无需清理（目录不存在）`)
    }
  } catch (error) {
    console.error(`[before-pack] ❌ 清理失败:`, error.message)
    throw error
  }
}

module.exports = beforePack

