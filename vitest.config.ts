import { defineConfig, configDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    // Les worktrees Claude Code (.claude/worktrees) contiennent une copie du dépôt : ne pas exécuter leurs tests.
    exclude: [...configDefaults.exclude, '.claude/**', 'apps/debourse-dotnet/**'],
  },
});
