# GitHub Workflows Overview

This repository contains several GitHub Actions workflows that automate various processes, including building, testing, versioning, and releasing your project. Below is an overview of each workflow and how they contribute to the release process.

## Workflows

### 1. `version-bump.yml`

This workflow handles both versioning and release creation through two separate jobs:

#### Version Bump Job
- **Trigger**: Runs when a pull request review is approved
- **Version Bump**: 
  - Determines version bump type based on PR labels (major, minor, patch, alpha)
  - Uses `npm version` to update version in `package.json`
  - For alpha releases, creates versions with `-alpha.N` suffix
  - Skips version bump if PR has `no-release` label
  - Checks if version needs to be bumped again using `bump-check.sh`

#### Create Release Job
- **Trigger**: Runs on pushes to the `main` branch
- **Action**: Creates a prerelease draft on GitHub with auto-generated release notes

### 2. `build-test-report.yml`

Handles continuous integration tasks:

- **Trigger**: Runs on pull requests and pushes to `main`
- **Actions**:
  - Sets up Node.js 20 and Yarn 4.5.0
  - Installs dependencies
  - Runs build process
  - Executes tests with coverage
  - Uploads test results and coverage reports
  - Reports coverage to Codecov

### 3. `naming-conventions.yml`

Enforces PR conventions:

- **Trigger**: Runs on PR events (opened, edited, labeled, unlabeled, synchronize)
- **Validations**:
  - Ensures PR titles follow Conventional Commits specification
  - Verifies exactly one release label is present (major, minor, patch, no-release, alpha)
- **Feedback**: Adds/removes automated comments on PRs for validation issues

### 4. `publish-release.yml`

Handles NPM package publishing:

- **Trigger**: Runs when a GitHub release is published (moved from draft to released)
- **Actions**:
  - Builds the project
  - Publishes to NPM with provenance enabled
  - Uses Node.js native `npm publish` command for provenance support

## Release Process

1. **Pull Request Stage**:
   - PR must have a Conventional Commits compliant title
   - PR must have exactly one release label (major, minor, patch, alpha, no-release)
   - Build and tests must pass

2. **Version Bumping**:
   - Triggered by PR approval
   - Version is bumped based on PR label
   - Skipped if PR has `no-release` label
   - Additional checks prevent duplicate version bumps

3. **Release Creation**:
   - Draft release is automatically created on `main` branch updates
   - Release notes are auto-generated
   - Created as a prerelease initially

4. **Publishing**:
   - When release is published on GitHub, package is automatically published to NPM
   - Uses NPM provenance for enhanced security
   - Published with public access

## Scripts

The workflow uses two helper scripts:

### `bump-check.sh`
- Prevents duplicate version bumps
- Checks if version already exists in releases
- Verifies if version was already bumped in current branch

### `pr-label-check.sh`
- Validates PR labels
- Ensures exactly one release label is present
- Returns the type of release or `no-release`
