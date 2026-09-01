/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the workspace protocol package as TS source.
  transpilePackages: ["@openremote/protocol"],
  webpack(config) {
    // The protocol package uses NodeNext-style ".js" specifiers on ".ts"
    // sources. Teach webpack to resolve them to the TS files.
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".tsx", ".js", ".jsx"],
    }
    return config
  },
}

export default nextConfig
