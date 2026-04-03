export default {
  branches: ['master'],
  plugins: [
    ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
    [
      '@semantic-release/release-notes-generator',
      {
        preset: 'conventionalcommits',
        presetConfig: {
          types: [
            { type: 'feat', section: 'Features' },
            { type: 'fix', section: 'Bug Fixes' },
            { type: 'perf', section: 'Performance Improvements' },
            { type: 'deps', section: 'Dependencies' },
            { type: 'revert', section: 'Reverts' },
            { type: 'docs', section: 'Documentation', hidden: true },
            { type: 'style', section: 'Styles', hidden: true },
            { type: 'chore', section: 'Miscellaneous', hidden: true },
            { type: 'refactor', section: 'Code Refactoring', hidden: true },
            { type: 'test', section: 'Tests', hidden: true },
            { type: 'build', section: 'Build System', hidden: true },
            { type: 'ci', section: 'CI', hidden: true },
          ],
        },
      },
    ],
    '@semantic-release/changelog',
    '@semantic-release/npm',
    [
      '@semantic-release/git',
      {
        assets: ['package.json', 'CHANGELOG.md'],
        message: 'chore: release v${nextRelease.version} [skip ci]',
      },
    ],
    [
      '@semantic-release/github',
      {
        assets: [
          { path: 'dist/horizon-mcp-linux-x64', label: 'Linux x64' },
          { path: 'dist/horizon-mcp-linux-arm64', label: 'Linux arm64' },
          { path: 'dist/horizon-mcp-darwin-x64', label: 'macOS x64' },
          { path: 'dist/horizon-mcp-darwin-arm64', label: 'macOS arm64' },
          { path: 'dist/horizon-mcp-windows-x64.exe', label: 'Windows x64' },
        ],
      },
    ],
  ],
};
