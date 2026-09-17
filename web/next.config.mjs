/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the distroless-style Docker image (web/Dockerfile).
  output: 'standalone',
  async rewrites() {
    const backendUrl = process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
    return [
      { source: '/login', destination: '/' },
      { source: '/signup', destination: '/' },
      { source: '/auth', destination: '/' },
      { source: '/api/:path*', destination: `${backendUrl}/api/:path*` },
      { source: '/socket.io/:path*', destination: `${backendUrl}/socket.io/:path*` },
    ];
  },
};

export default nextConfig;
