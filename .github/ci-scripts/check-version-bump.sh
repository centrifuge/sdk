#!/bin/bash

# Get the current version from package.json
current_version=$(node -p "require('./package.json').version")
current_commit=$(git rev-parse --short HEAD)

# Get the previous version from the last commit
previous_version=$(git show HEAD~1:package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf-8')).version")
previous_commit=$(git rev-parse --short HEAD~1)

# Compare the versions
if [ "$current_version" != "$previous_version" ]; then
  echo "Version changed from $previous_version (commit $previous_commit) to $current_version (commit $current_commit)"
  echo "Creating release https://github.com/centrifuge/sdk/releases/tag/$current_version"
  exit 0
else
  echo "Version $current_version remains unchanged between commits $previous_commit and $current_commit"
  # Initialize error flag
  has_error=0

  # Check if GitHub release exists
  if ! curl -s -f "https://api.github.com/repos/centrifuge/sdk/releases/tags/v${current_version}" &>/dev/null; then
    echo "ERROR: GitHub tag v${current_version} does not exist."
    has_error=1
  fi

  # Check if npm package version exists
  if ! npm view "@centrifuge/sdk@${current_version}" version &>/dev/null; then
    echo "ERROR: NPM package @centrifuge/sdk@${current_version} does not exist."
    has_error=1
  fi

  # Exit with error if either check failed
  if [ $has_error -eq 1 ]; then
    echo "Maybe a step was skipped for v$current_version? Please check the release manually."
    exit 1
  fi
  # If the version on package.json is released and hasn't changed, exit without errors.
  exit 0
fi