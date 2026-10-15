# Contributing to CloudCLI UI

Thanks for your interest in contributing to CloudCLI UI! Before you start, please take a moment to read through this guide.

## Before You Start

- **Search first.** Check [existing issues](https://github.com/siteboon/claudecodeui/issues) and [pull requests](https://github.com/siteboon/claudecodeui/pulls) to avoid duplicating work.
- **Discuss first** for new features. Open an [issue](https://github.com/siteboon/claudecodeui/issues/new) to discuss your idea before investing time in implementation. We may already have plans or opinions on how it should work.
- **Bug fixes are always welcome.** If you spot a bug, feel free to open a PR directly.

## Prerequisites

- [Node.js](https://nodejs.org/) 22 or later
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and configured

## Getting Started

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/<your-username>/claudecodeui.git
   cd claudecodeui
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
   npm 12 and later only run dependency install scripts listed under `allowScripts` in `package.json`.
   If the server fails at startup with `Could not locate the bindings file` (better-sqlite3) or a native
   module such as `node-pty` or `bcrypt` is missing, list the blocked packages, approve the one you need
   and rebuild it:
   ```bash
   npm install-scripts ls
   npm install-scripts approve better-sqlite3
   npm rebuild better-sqlite3
   ```
   Approvals are pinned to exact versions, so a dependency bump needs a new approval.
4. Start the development server:
   ```bash
   npm run dev
   ```
5. Create a branch for your changes:
   ```bash
   git checkout -b feat/your-feature-name
   ```

## Project Structure

```
claudecodeui/
├── src/                  # React frontend (Vite + Tailwind)
│   ├── modules/<feature>/  # One folder per feature, public API in index.ts
│   └── shared/           # Cross-module UI, hooks, contexts, types, utils, API client (api.ts)
├── server/               # Express + WebSocket backend (TypeScript)
│   ├── modules/<feature>/  # One folder per feature: routes, services, tests, index.ts barrel
│   └── shared/           # Cross-module types, interfaces, utils
├── shared/               # Code shared between client and server
├── docs/architecture/    # Chat runtime design notes
├── plugins/starter/      # Plugin starter (git submodule)
├── electron/             # Desktop companion app
└── public/               # Static assets, icons, PWA manifest
```

Module rules for `server/` and `src/` are described in `.agents/skills/backend-module-standards/SKILL.md`
and `.agents/skills/frontend-module-standards/SKILL.md`.

## Development Workflow

- `npm run dev` — Start both the frontend and backend in development mode
- `npm run server:dev` — Start only the backend from source (`server:dev-watch` reloads on changes)
- `npm run client` — Start only the Vite dev server
- `npm run build` — Create a production build
- `npm run server` — Start only the backend from the production build
- `npm test` / `npm run test:client` — Backend / frontend tests
- `npm run typecheck` and `npm run lint` — Type checking and linting
- `make start` / `make stop` / `make status` / `make logs` — Run the production build as a background service (`MODE=dev` for the dev stack, `make help` for all targets)
- `make service-install` — Install the production build as a systemd service (`make service-unit` previews the unit; `service-start`/`stop`/`restart`/`status`/`logs`/`uninstall` manage it)
- `make remote-install REMOTE=user@host` — Copy the working tree to another machine over SSH, build it there and install the service (`remote-deploy` to update; `remote-start`/`stop`/`restart`/`status`/`logs`/`uninstall`/`ssh` to manage it)
- `make git-identity` — Set git `user.name`/`user.email` of the service user from `GIT_USER_NAME`/`GIT_USER_EMAIL` in `.env`; `remote-install` and `remote-deploy` copy them into each node's `.env` and apply them there (`remote-git-identity` does only that)

## Making Changes

### Bug Fixes

- Reference the issue number in your PR if one exists
- Describe how to reproduce the bug in your PR description
- Add a screenshot or recording for visual bugs

### New Features

- Keep the scope focused — one feature per PR
- Include screenshots or recordings for UI changes

### Documentation

- Documentation improvements are always welcome
- Keep language clear and concise

## Commit Convention

We follow [Conventional Commits](https://conventionalcommits.org/) to generate release notes automatically. Every commit message should follow this format:

```
<type>(optional scope): <description>
```

Use imperative, present tense: "add feature" not "added feature" or "adds feature".

### Types

| Type | Description |
|------|-------------|
| `feat` | A new feature |
| `fix` | A bug fix |
| `perf` | A performance improvement |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `docs` | Documentation only |
| `style` | CSS, formatting, visual changes |
| `chore` | Maintenance, dependencies, config |
| `ci` | CI/CD pipeline changes |
| `test` | Adding or updating tests |
| `build` | Build system changes |

### Examples

```bash
feat: add conversation search
feat(i18n): add Japanese language support
fix: redirect unauthenticated users to login
fix(editor): syntax highlighting for .env files
perf: lazy load code editor component
refactor(chat): extract message list component
docs: update API configuration guide
```

### Breaking Changes

Add `!` after the type or include `BREAKING CHANGE:` in the commit footer:

```bash
feat!: redesign settings page layout
```

## Pull Requests

- Give your PR a clear, descriptive title following the commit convention above
- Fill in the PR description with what changed and why
- Link any related issues
- Include screenshots for UI changes
- Make sure the build passes (`npm run build`)
- Keep PRs focused — avoid unrelated changes

## Releases

Releases are managed by maintainers using [release-it](https://github.com/release-it/release-it) with the [conventional changelog plugin](https://github.com/release-it/conventional-changelog).

```bash
npm run release           # interactive (prompts for version bump)
npm run release -- patch  # patch release
npm run release -- minor  # minor release
```

This automatically:
- Bumps the version based on commit types (`feat` = minor, `fix` = patch)
- Generates categorized release notes
- Updates `CHANGELOG.md`
- Creates a git tag and GitHub Release
- Publishes to npm

## License

By contributing, you agree that your contributions will be licensed under the [AGPL-3.0-or-later License](LICENSE), including the additional terms specified in Section 7 of the LICENSE file.