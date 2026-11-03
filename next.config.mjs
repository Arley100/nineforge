/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The Docker image sets NEXT_OUTPUT=standalone for a minimal, self-contained server.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" } : {}),
};
export default nextConfig;
