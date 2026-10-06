/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingIncludes: {
    // keep nothing extra; all runtime data lives in .data/
  },
};

export default nextConfig;
