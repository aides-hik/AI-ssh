/** Deterministic fixtures for the browser preview; these addresses are never contacted. */
export const PREVIEW_SERVERS = [
  { id: 'preview-server', name: '演示服务器 · UI 测试', host: 'demo.prism.local', hostname: 'prism-demo', role: '应用服务', delay: 1200, cpu: '12.4%', memory: '2.1 GiB / 8.0 GiB (26%)', disk: '28G / 100G (28%)', services: 'prism-api.service active running\nnginx.service active running' },
  { id: 'preview-web-02', name: 'Web 节点 02 · UI 测试', host: 'web-02.prism.local', hostname: 'prism-web-02', role: 'Web 服务', delay: 1800, cpu: '31.8%', memory: '3.4 GiB / 8.0 GiB (43%)', disk: '36G / 100G (36%)', services: 'nginx.service active running\nprism-web.service active running' },
  { id: 'preview-db-01', name: '数据库节点 01 · UI 测试', host: 'db-01.prism.local', hostname: 'prism-db-01', role: '数据库', delay: 2400, cpu: '46.2%', memory: '11.2 GiB / 16.0 GiB (70%)', disk: '88G / 100G (88%)', services: 'postgresql.service active running\nredis-server.service active running' }
] as const

export function previewServer(id: string) {
  return PREVIEW_SERVERS.find(server => server.id === id) || PREVIEW_SERVERS[0]
}

export function previewInspectionOutput(id: string, command: string): string | undefined {
  const server = previewServer(id)
  const sections: Record<string, string> = {
    SYSTEM: `Hostname: ${server.hostname}\nRole: ${server.role}\nLinux ${server.hostname} 6.12.0 x86_64 GNU/Linux\nPRETTY_NAME="Ubuntu 24.04.3 LTS"\nAll data are simulated for UI preview.`,
    CPU: `CPU usage: ${server.cpu}\nCPU cores: 4\nLoad average: ${id === 'preview-db-01' ? '1.86 1.74 1.65' : '0.48 0.39 0.32'}`,
    MEMORY: `Memory: ${server.memory}\nSwap: 0 B / 2.0 GiB`,
    DISK: `Filesystem      Size  Used Avail Use% Mounted on\n/dev/vda1       100G   ${id === 'preview-db-01' ? '88G   12G  88%' : id === 'preview-web-02' ? '36G   64G  36%' : '28G   72G  28%'} /`,
    SERVICES: server.services,
    NETWORK: `State  Local Address:Port\nLISTEN 0.0.0.0:22\n${id === 'preview-db-01' ? 'LISTEN 127.0.0.1:5432\nLISTEN 127.0.0.1:6379' : 'LISTEN 0.0.0.0:80\nLISTEN 0.0.0.0:443'}`
  }
  const checks = [...command.matchAll(/PRISM_INSPECT_(SYSTEM|CPU|MEMORY|DISK|SERVICES|NETWORK)/g)].map(match => match[1])
  if (!checks.length) return undefined
  return [...new Set(checks)].map(check => `--- PRISM_INSPECT_${check} ---\n${sections[check]}`).join('\n\n')
}
