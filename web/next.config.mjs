/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Required for the distroless-style Docker image (web/Dockerfile).
  output: 'standalone',
};

export default nextConfig;
