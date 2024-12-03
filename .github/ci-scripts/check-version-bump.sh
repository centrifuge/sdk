#!/bin/bash

# Get the current version from package.json
current_version=$(node -p "require('./package.json').version")

# Get the previous version from the last commit
previous_version=$(git show HEAD~1:package.json | node -p "JSON.parse(require('fs').readFileSync(0, 'utf-8')).version")

# Compare the versions
if [ "$current_version" != "$previous_version" ]; then
  echo "Version has been bumped from $previous_version to $current_version."
  exit 0
else
  echo "Version has not been bumped."
  exit 1
fi