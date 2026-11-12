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
3. **Stage.** When `packages/sdk/package.json` on `main` carries a version that is neither on npm nor
   tagged yet, `publish-release.yml` builds the package, verifies it, and stages it on npm with
   provenance. It then tags the commit `v<version>`. A merge without a version change stages nothing.
4. **Approve.** A staged version is not installable until an npm maintainer approves it with 2FA, on
   npmjs.com under the package's Staged Packages tab or with `npm stage approve <stage-id>` (npm 11.15.0
   or later); the run's summary names the stage id. `npm stage reject <stage-id>` discards it.

There are no release labels and no GitHub release to promote.

The tag `v<version>` marks a staged version and names the commit it was built from. A version that is
tagged but not on npm is waiting for approval, or was rejected, and is not staged again: a later run
with the same version stops with a notice, or with a warning when `main` has moved past the staged
commit. To stage a version again after rejecting it, delete its tag and run `publish-release.yml` from
`main`.

Only the version on `main` when a run starts is staged. Runs queue one at a time, and a newer run
replaces a waiting one, so a version that was on `main` only between two runs is skipped on npm.

## Workflows

### `publish-release.yml`

- **Trigger**: push to `main` that changes `packages/sdk/package.json`, or a manual run from `main`
- **Jobs**:
  - `build`: skips when the version is already on npm or already tagged; otherwise installs (the only
    step that holds the GitHub Packages token), runs `build:publish` and `verify:publish`, and packs the
    tarball
  - `stage`: in the `release` environment, the only job with `id-token: write`; sees only the tarball and
    runs `npm stage publish --provenance` over npm trusted publishing (OIDC), so no npm token is stored
  - `tag`: pushes `v<version>` once the version is staged, and fails if the tag already points at
    another commit
- npm's trusted publisher is bound to this file name and the `release` environment: renaming either
  breaks publishing.

### `build-test-report.yml`

- **Trigger**: pull requests to `main` and pushes to `main`
- **Actions**: installs the workspace, runs `build:publish`, `verify:publish` and `test:unit`

Both workflows install through `.github/actions/install`, which sets up pnpm and Node and runs a frozen
install with the GitHub Packages token in that step only.

### `mirror-guard.yml`

- **Trigger**: `pull_request_target`, so `main`'s copy of the guard judges every pull request and a pull
  request cannot change it. Nothing from the pull request is checked out or run.
- **Check**: a pull request that changes mirror-owned paths must be opened by the mirror App from
  `mirror/main`, and every commit in it must be the App's; a mirror pull request may change only
  mirror-owned paths. A pull request with more changed files than the API lists (3000) fails. The App's
  login comes from the repository variable `SDK_MIRROR_APP_LOGIN`; without it no pull request counts as
  the mirror's, so changes to mirror-owned paths fail and changes to repository-owned paths still pass.

### `naming-conventions.yml`

- **Trigger**: pull request events
- **Check**: the pull request title follows the Conventional Commits specification

### `pinned-actions-check.yml`

- **Trigger**: pull requests that change workflows or actions
- **Check**: every GitHub Action is pinned to a full commit SHA

## Repository settings

The workflows rely on these settings:

- **Ruleset on `main`**: pull request required with one approval and review from Code Owners, so a
  change under `.github/` needs a code owner; required checks `build-n-test`, `mirror-guard` and
  `title-n-label-check`; no bypass for the mirror App.
- **Ruleset on `mirror/main`**: only the mirror App may push. The guard also refuses commits that are
  not the App's, but commit metadata can be forged, so this ruleset is the control.
- **Tags `v*`**: GitHub Actions may create them, or the `tag` job fails after staging.

## Installing

`packages/protocol` depends on `@centrifuge/addressbook`, which is published to GitHub Packages. The
workflows install it with their `GITHUB_TOKEN` and `packages: read`; this repository has read access to
the package.
