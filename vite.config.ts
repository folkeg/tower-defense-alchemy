import { defineConfig } from "vite";

// GitHub Pages 部署在 https://<owner>.github.io/tower-defense-alchemy/ 子路径下，
// 需要设置 base 才能让打包后的资源引用路径正确。
// 本地开发（vite dev）不受影响，因为 dev server 仍然从根路径提供服务。
export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/tower-defense-alchemy/" : "/",
});
