/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume the workspace protocol package as TS source. `ably` ships a UMD
  // browser bundle webpack can't parse raw (super-outside-method); transpiling
  // it fixes the build.
  transpilePackages: ["@openremote/protocol", "ably"],
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
