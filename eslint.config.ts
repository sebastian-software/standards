import { getEslintConfig } from "eslint-config-setup";

const config = await getEslintConfig({ node: true, oxlint: true });

config.unshift({
  ignores: [
    "**/dist/**",
    "coverage/**",
    "node_modules/**",
    "pnpm-lock.yaml",
    "reference/**",
    "**/*.json",
    "**/*.md",
  ],
});

// The CLI's whole job is reading and writing repo files from dynamic paths
// and spawning the agent CLIs (claude/codex) as child processes.
config.push({
  files: ["src/**/*.ts", "test/**/*.ts"],
  rules: {
    "security/detect-non-literal-fs-filename": "off",
    "security/detect-child-process": "off",
  },
});

export default config;
