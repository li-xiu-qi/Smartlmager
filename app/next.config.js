/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // 本机通过 127.0.0.1 / localhost / Tailscale IP 访问开发服务器，需显式放行
  allowedDevOrigins: ['127.0.0.1', 'localhost', '100.117.16.8'],
  async rewrites() {
    return [
      // 推理服务路由没有 /api/v1 前缀，直接按路径转发
      { source: '/api/v1/encode', destination: 'http://192.168.1.170:8100/encode' },
      { source: '/api/v1/analyze', destination: 'http://192.168.1.170:8100/analyze' },
      { source: '/api/v1/vectors/:path*', destination: 'http://192.168.1.170:8100/vectors/:path*' }
    ]
  }
}
export default nextConfig
