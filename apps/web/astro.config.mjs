import { defineConfig } from "astro/config";
import icon from "astro-icon";

const quickDomain = process.env.QUICK_DOMAIN || "local.example.com";
const platformProxy = process.env.QUICK_PLATFORM_PROXY || `https://${quickDomain}`;

export default defineConfig({
  integrations: [
    icon({
      include: {
        lucide: ["log-out"],
      },
    }),
  ],
  output: "static",
  outDir: "./dist",
  publicDir: "./static",
  vite: {
    server: {
      allowedHosts: true,
      hmr: {
        protocol: "wss",
        clientPort: 443,
      },
      proxy: {
        "/api": {
          target: platformProxy,
          changeOrigin: true,
          secure: false,
        },
        "/quick.js": {
          target: platformProxy,
          changeOrigin: true,
          secure: false,
        },
      },
    },
  },
});
