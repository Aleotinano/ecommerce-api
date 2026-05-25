import { defineConfig } from "vitest/config";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.test", override: true });

export default defineConfig({
  test: {
    include: ["tests/**/*.test.js"],
    fileParallelism: false,
    pool: "forks",
    forks: { singleFork: true },
    testTimeout: 30000,
    hookTimeout: 60000,
    globalSetup: ["tests/global-setup.js"],
    env: {
      ...process.env,
      NODE_ENV: "test",
    },
  },
});
