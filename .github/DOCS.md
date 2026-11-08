# GitHub Workflows Overview

## Where the code comes from

The SDK is developed in a private monorepo. Its source reaches this repository through the
**mirror**: a GitHub App opens and updates one pull request from branch `mirror/main`, carrying the
workspace (`packages/sdk`, `packages/protocol`, `packages/queries`) and the generated root files. This
repository owns only `.github/`, `docs/`, `README.md`, `LICENSE` and `.npmrc`; the mirror owns the rest.

Pull requests that change SDK code here are refused by `mirror-guard.yml`. Changes land in the
private monorepo and arrive through the next mirror pull request.

## Release Process

1. **Version.** The version is set in the private monorepo (`packages/sdk/package.json`) and arrives
   with the mirror pull request. Nothing in this repository bumps it.
2. **Merge.** A maintainer reviews and merges the mirror pull request. That is the only human step in
   this repository.
3. **Stage.** When `packages/sdk/package.json` on `main` carries a version that is not on npm yet,
   `publish-release.yml` builds the package, verifies it, and stages it on npm with provenance. It then
   tags the commit `v<version>`. A merge without a version change stages nothing.
4. **Approve.** A staged version is not installable until an npm maintainer approves it with 2FA, on
   npmjs.com under the package's Staged Packages tab or with `npm stage list @centrifuge/sdk` then
   `npm stage approve <stage-id>` (npm 11.15.0 or later). `npm stage reject <stage-id>` discards it.

There are no release labels and no GitHub release to promote.

## Workflows

### `publish-release.yml`

- **Trigger**: push to `main` that changes `packages/sdk/package.json`, or a manual run from `main`
- **Jobs**:
  - `build`: skips when the version is already on npm; otherwise installs, runs `build:publish` and
    `verify:publish`, and packs the tarball
  - `stage`: in the `release` environment, the only job with `id-token: write`; sees only the tarball and
    runs `npm stage publish --provenance` over npm trusted publishing (OIDC), so no npm token is stored
  - `tag`: pushes `v<version>` once the version is staged
- npm's trusted publisher is bound to this file name and the `release` environment: renaming either
  breaks publishing.

### `build-test-report.yml`

- **Trigger**: pull requests to `main` and pushes to `main`
- **Actions**: installs the workspace, runs `build:publish`, `verify:publish` and `test:unit`

### `mirror-guard.yml`

- **Trigger**: pull request events
- **Check**: a pull request that changes mirror-owned paths must be opened by the mirror App from
  `mirror/main`; a mirror pull request may change only mirror-owned paths. The App's login comes from
  the repository variable `SDK_MIRROR_APP_LOGIN`; without it the check fails.

### `naming-conventions.yml`

- **Trigger**: pull request events
- **Check**: the pull request title follows the Conventional Commits specification

### `pinned-actions-check.yml`

- **Trigger**: pull requests that change workflows or actions
- **Check**: every GitHub Action is pinned to a full commit SHA

## Installing

`packages/protocol` depends on `@centrifuge/addressbook`, which is published to GitHub Packages. The
workflows install it with their `GITHUB_TOKEN` and `packages: read`; this repository has read access to
the package.
