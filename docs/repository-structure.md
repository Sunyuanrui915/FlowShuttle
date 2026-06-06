# Flow Shuttle Repository Structure Review

This note records the first-stage repository structure review before opening the project.

## Current Structure Overview

```text
.
├── docs/
├── scripts/
├── src/
│   ├── main/
│   ├── preload/
│   ├── renderer/
│   └── shared/
├── electron.vite.config.ts
├── package.json
├── package-lock.json
└── tsconfig.json
```

Ignored local-only directories and generated files include `node_modules/`, `out/`, `release/`, `dev-data/`, `.visual-user-data/`, logs, local shortcuts, and temporary debug files.

## Obvious Issues Before Public Release

- The core app structure is usable, but release, test-data, and safety documentation are still early.
- Some historical internal identifiers remain in areas that may affect app identity or data paths.
- Generated Electron packaging output exists locally and must stay ignored.
- Test data and attachment fixtures must not be committed.

## Safe First-Stage Organization

The first stage can safely add:

- `README.md`
- `LICENSE`
- `CONTRIBUTING.md`
- `CHANGELOG.md`
- `ROADMAP.md`
- `AGENTS.md`
- `docs/`
- `.github/`

## Directories Not Recommended To Move Now

Do not move or restructure these in the first stage:

- `src/main/`
- `src/preload/`
- `src/renderer/`
- `src/shared/`
- `scripts/`
- Electron build configuration
- SQLite schema and migration code
- IPC and preload wiring
- data directory and save logic

These areas are coupled to runtime behavior, packaging, and user data safety.

## Recommended First-Stage Structure

```text
.
├── .github/
├── docs/
├── scripts/
├── src/
├── AGENTS.md
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

Further cleanup should wait until the app identity, data directory policy, packaging plan, and release workflow are reviewed together.
