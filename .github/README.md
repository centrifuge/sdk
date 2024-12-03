# GitHub Workflows Overview

This repository contains several GitHub Actions workflows that automate various processes, including building, testing, versioning, and releasing your project. Below is an overview of each workflow and how they contribute to the release process.

## Workflows

### 1. `prepare-release.yml`

This workflow is responsible for versioning and preparing releases based on pull request labels.

- **Trigger**: Runs on pull request reviews that are approved.
- **Version Bump**: Determines the version bump type (major, minor, patch) based on PR labels. If an `alpha` label is present, it creates a prerelease version.
- **Versioning**: Uses `yarn version` to update the version in `package.json`.
- **Outputs**: Provides the version type and alpha status for subsequent workflows.

### 2. `build-test-report.yml`

This workflow handles building, testing, and reporting.

- **Trigger**: Runs on pull requests and pushes to the `main` branch.
- **Build and Test**: Installs dependencies, builds the project, and runs tests.
- **Reporting**: Uploads test results and coverage reports to Codecov.

### 3. `naming-conventions.yml`

This workflow ensures that pull request titles and labels follow specific conventions.

- **Trigger**: Runs on various pull request events (opened, edited, labeled, etc.).
- **Title Check**: Validates PR titles against the Conventional Commits specification.
- **Label Check**: Ensures PRs have one of the required labels (major, minor, patch, no-release).
- **Comments**: Adds or removes comments on PRs based on title and label validation results.

### 4. `create-release.yml`

This workflow creates a draft release on GitHub when a new version is detected in `package.json` on the `main` branch.

- **Trigger**: Runs on pushes to the `main` branch.
- **Version Check**: Verifies if the version in `package.json` has been updated.
- **Draft Release**: Creates a draft release with the new version tag if the version check is successful.

### 5. `publish-release.yml`

This workflow handles the publishing of releases to NPM.

- **Trigger**: Runs when a release is published on GitHub.
- **Build and Publish**: Checks out the code, installs dependencies, builds the project, and publishes it to NPM.
- **Provenance**: Uses `npm publish` with provenance for security.

## Release Process

1. **Versioning**: The `prepare-release.yml` workflow determines the version bump based on PR labels after a review has been approved. If a PR is labeled with `major`, `minor`, or `patch`, the version is updated accordingly. If labeled with `alpha`, a prerelease version is created.

2. **Draft Release Creation**: The `create-release.yml` workflow creates a draft release if `package.json` contains a new version on the `main` branch.

3. **Publishing**: When a release is published on GitHub (moved from draft to released), the `publish-release.yml` workflow is triggered. It builds the project and publishes it to NPM, ensuring the package is available for public use.

