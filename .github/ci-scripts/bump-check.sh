#!/bin/bash

# This script:
# 1. Checks if the version in package.json has already been released.
# This means another PR made it to main before this one and we need to bump the version again.
# 2. Check if the version has already been bumped in this branch (more than one PR approval)
# If so, skip the version bump.

VERSION=$(node -p "require('./package.json').version")
RELEASE_TAGS=$(gh release list --json tagName --jq '.[].tagName')
# Check for version with 'v' prefix since release tags include it
RELEASE_EXISTS=$(echo "$RELEASE_TAGS" | grep -x "v$VERSION" || true)

if [ "$RELEASE_EXISTS" == "v$VERSION" ]; then
    echo "::warning::Version $VERSION has already been released, bump again"
    echo "true"
    exit 0
else
    # Find the commit where the branch diverged from main
    git fetch origin main
    MERGE_BASE=$(git merge-base origin/main HEAD)

    # Check commits between merge-base and current HEAD
    COMMITS=$(git log $MERGE_BASE..HEAD --format=%B)
    if echo "$COMMITS" | grep -q "\[bot\] New pkg version:"; then
        VERSION_COMMIT=$(echo "$COMMITS" | grep "\[bot\] New pkg version:" | head -n 1)
        echo "::warning::Version was already bumped in this branch with commit message: $VERSION_COMMIT"
        echo "false"
    else
        echo "No version bump found in branch commits"
        echo "true"
    fi
fi