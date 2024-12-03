#!/bin/bash

# Read the current version from package.json
current_version=$(node -p "require('./package.json').version")

# Check if version contains alpha
if [[ "$current_version" == *"-alpha"* ]]; then
  # Remove alpha if present
  new_version="${current_version%%-alpha*}"
elif [[ "$1" == "yes" ]]; then
  # Add alpha if not present and "yes" was passed
  new_version="${current_version}-alpha"
else
  # Keep current version if no alpha and no "yes" passed
  new_version="${current_version}"
fi

# Update the package.json with the new version
node -e "
  let pkg = require('./package.json');
  pkg.version = '$new_version';
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2));
"

echo "Updated version to $new_version"