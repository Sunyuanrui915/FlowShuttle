# Flow Shuttle Repository Structure

This document describes the current public repository layout and the boundaries that should remain stable during incremental development.

## Current Structure

```text
.
├── .github/                 # GitHub repository configuration
├── docs/                    # Public guides, release notes, and screenshots
├── feedback-service/        # User-triggered feedback delivery service
├── scripts/                 # Verification and development helpers
├── src/
│   ├── main/                # Electron main process
│   ├── preload/             # Restricted renderer bridge
│   ├── renderer/            # React application and editor UI
│   └── shared/              # Shared contracts and validation
├── AGENTS.md                # Project execution and safety rules
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── ROADMAP.md
├── electron.vite.config.ts
├── package.json
├── package-lock.json
└── tsconfig.json
```

## Protected Runtime Areas

Changes to these areas require focused review and verification because they can affect user data, desktop security, or release behavior:

- SQLite schema and migrations;
- data-directory selection and save logic;
- Electron main-process startup and window behavior;
- IPC contracts and the preload bridge;
- report generation and Markdown export;
- attachment storage and deletion;
- automatic update and packaging behavior.

See [AGENTS.md](../AGENTS.md) for the complete project rules.

## Generated and Local-Only Content

Build outputs, local databases, caches, test data, shortcuts, and logs must remain outside version control. The repository `.gitignore` covers generated runtime output such as `node_modules/`, `out/`, `release/`, `dev-data/`, `.visual-user-data/`, and common database or log files.

The following project-owner workspaces are also intentionally local-only and must not be staged or published:

- `ai-state/`;
- `design-qa.md`;
- `docs/assets/social-updates/`;
- `docs/promo-video/`.

Stage exact task files rather than using broad staging commands.

## Change Strategy

- Keep changes incremental and branch-based.
- Preserve existing data, UI, and release behavior unless the task explicitly changes them.
- Avoid broad directory moves or architecture rewrites for cleanup alone.
- Add focused verification whenever editor semantics, data handling, desktop behavior, or packaging changes.
