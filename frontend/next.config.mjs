import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const isDesktopBuild = process.env.DESKTOP_BUILD === 'true';
const isWebStaticBuild = process.env.WEB_STATIC_BUILD === 'true';
const isStaticBuild = isDesktopBuild || isWebStaticBuild;

const nextConfig = {
  trailingSlash: true,
  output: isStaticBuild && process.env.NODE_ENV === 'production' ? 'export' : 'standalone',
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '',
    DESKTOP_BUILD: process.env.DESKTOP_BUILD ?? '',
    NEXT_PUBLIC_DEPLOYMENT_MODE:
      process.env.NEXT_PUBLIC_DEPLOYMENT_MODE ?? process.env.WHYLOWDPS_DEPLOYMENT ?? '',
  },
  images: {
    unoptimized: isStaticBuild,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wow.zamimg.com",
        pathname: "/images/wow/icons/**",
      },
    ],
  },
  turbopack: {
    root: workspaceRoot,
  },
  ...(isStaticBuild
    ? {}
    : {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || (isDesktopBuild ? 'http://localhost:17384' : 'http://127.0.0.1:8000')}/api/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
