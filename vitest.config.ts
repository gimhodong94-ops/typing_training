import { mergeConfig, defineConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: { exclude: ["archive/**", "node_modules/**", "dist/**"] },
}));
