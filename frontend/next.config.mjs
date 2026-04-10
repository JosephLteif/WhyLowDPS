/** @type {import('next').NextConfig} */
const nextConfig = {
  trailingSlash: true,
  output: (process.env.DESKTOP_BUILD && process.env.NODE_ENV === 'production') ? "export" : "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "",
    DESKTOP_BUILD: process.env.DESKTOP_BUILD ?? "",
  },
  images: {
    unoptimized: !!process.env.DESKTOP_BUILD,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "wow.zamimg.com",
        pathname: "/images/wow/icons/**",
      },
    ],
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || (process.env.DESKTOP_BUILD ? 'http://localhost:17384' : 'http://localhost:8000')}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
