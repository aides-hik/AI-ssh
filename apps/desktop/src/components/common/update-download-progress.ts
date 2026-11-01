export interface UpdateDownloadState {
  status: string
  progress?: number
  downloadedBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
}

function validNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

export function formatUpdateBytes(value: number): string {
  const bytes = validNumber(value) ?? 0
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const unit = bytes === 0 ? 0 : Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const size = bytes / 1024 ** Math.max(0, unit)
  return `${unit <= 0 ? Math.round(bytes) : Number(size.toFixed(1))} ${units[Math.max(0, unit)]}`
}

export function updateDownloadDisplay(state: UpdateDownloadState) {
  const complete = state.status === 'downloaded'
  const downloaded = validNumber(state.downloadedBytes)
  const reportedTotal = validNumber(state.totalBytes)
  const total = reportedTotal !== null && reportedTotal > 0 ? reportedTotal : null
  const verifying = !complete && total !== null && downloaded !== null && downloaded >= total
  const legacyProgress = validNumber(state.progress)
  const hasByteTelemetry = state.downloadedBytes !== undefined || state.totalBytes !== undefined
  const fraction = total !== null && downloaded !== null ? downloaded / total * 100
    : hasByteTelemetry ? null : legacyProgress
  const percent = complete ? 100 : fraction === null ? null : Math.min(99, Math.max(0, fraction))
  const percentText = percent === null ? '总大小未知' : `${Number(percent.toFixed(1))}%`
  const sizeText = complete
    ? total !== null || downloaded !== null ? formatUpdateBytes(total ?? downloaded ?? 0) : '安装包已就绪'
    : total !== null
      ? downloaded !== null ? `${formatUpdateBytes(downloaded)} / ${formatUpdateBytes(total)}` : `总大小 ${formatUpdateBytes(total)}`
      : downloaded !== null ? `已下载 ${formatUpdateBytes(downloaded)} · 总大小未知` : '正在获取下载大小'
  const speed = validNumber(state.bytesPerSecond)
  const speedText = complete || verifying ? '' : speed !== null && speed > 0
    ? `${formatUpdateBytes(speed)}/s`
    : speed === 0
      ? `0 B/s · ${downloaded !== null && downloaded > 0 ? '等待数据' : '正在连接下载源'}`
      : downloaded !== null && downloaded > 0 ? '正在计算速度' : '正在连接下载源'
  const title = complete ? '下载完成' : verifying ? '正在校验安装包' : '正在下载更新'
  return {
    visible: state.status === 'downloading' || complete,
    complete, title, percent, percentText, sizeText, speedText,
    accessibleText: [title, percentText, sizeText, speedText].filter(Boolean).join('，')
  }
}
