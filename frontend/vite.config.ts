import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  server: {
    port: 31011,
    strictPort: true,
    proxy: {
      "/api": {
        target:
          loadEnv(mode, process.cwd(), "").API_PROXY_TARGET ||
          "http://127.0.0.1:31010",
        changeOrigin: true,
      },
    },
  },
}));
