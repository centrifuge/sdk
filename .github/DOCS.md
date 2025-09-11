# GitHub Workflows Overview

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
   - Draft release is automatically created when PR is merged to `main`
   - Release notes are auto-generated
   - Created as a prerelease 

4. **Publishing**:
   - When a developer publishes a release on GitHub, package is automatically published to NPM -- Generally this will be done by editing the draft release from step 3
   - Uses NPM provenance for enhanced security
   - Published with public access
   
   **To publish a draft release:**
   
   **Option 1 - CLI**
   https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository#editing-a-release
   
   **Option 2 - GH website**
   https://github.com/centrifuge/sdk/releases
   (a draft release will appear in this URL as indicated in step 3 above)

## Workflows

### 1. `bump-version.yml`

This workflow handles version bumping:

- **Trigger**: Runs on pull request events (opened, reopened, labeled, synchronize)
- **Version Bump**:
  - Determines version bump type based on PR labels (major, minor, patch, alpha)
  - Uses `npm version` to update version in `package.json`
  - For alpha releases, creates versions with `-alpha.N` suffix
  - Skips version bump if PR has `no-release` label
  - Reverts version bump if `no-release` label is added after version was bumped

### 2. `create-release.yml`

This workflow handles release creation:

- **Trigger**: Runs when a pull request is closed (merged)
- **Action**: Creates a prerelease draft on GitHub with auto-generated release notes

### 3. `build-test-report.yml`

Handles continuous integration tasks:

- **Trigger**: Runs on pull requests and pushes to `main`
- **Actions**:
  - Sets up Node.js 20 and Yarn 4.5.0
  - Installs dependencies
  - Runs build process
  - Executes tests with coverage
  - Uploads test results and coverage reports
  - Reports coverage to Codecov

### 4. `naming-conventions.yml`

Enforces PR conventions:

- **Trigger**: Runs on PR events (opened, edited, labeled, unlabeled, synchronize)
- **Validations**:
  - Ensures PR titles follow Conventional Commits specification
  - Verifies exactly one release label is present (major, minor, patch, no-release, alpha)
- **Feedback**: Adds/removes automated comments on PRs for validation issues

### 5. `publish-release.yml`

Handles NPM package publishing:

- **Trigger**: Runs when a GitHub release is published (moved from draft to released)
- **Actions**:
  - Builds the project
  - Publishes to NPM with provenance enabled
  - Uses Node.js native `npm publish` command for provenance support

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