#!/bin/bash

echo "Testing npm publish with provenance..."
echo "Current npm version: $(npm --version)"
echo "Node version: $(node --version)"
echo "Repository: $GITHUB_REPOSITORY"
echo "Commit: $GITHUB_SHA"
echo "---"

# Check OIDC token availability
echo "Checking OIDC token availability..."
if [ -n "$ACTIONS_ID_TOKEN_REQUEST_TOKEN" ] && [ -n "$ACTIONS_ID_TOKEN_REQUEST_URL" ]; then
  echo "✅ OIDC token environment variables are set"
  echo "ACTIONS_ID_TOKEN_REQUEST_TOKEN: ${ACTIONS_ID_TOKEN_REQUEST_TOKEN:0:20}..."
  echo "ACTIONS_ID_TOKEN_REQUEST_URL: $ACTIONS_ID_TOKEN_REQUEST_URL"
else
  echo "❌ OIDC token environment variables are missing"
fi
echo "---"

# Run the actual publish (not dry-run)
echo "Publishing package with provenance..."
npm publish --provenance --access public --tag alpha

echo "---"
echo "✅ Package published successfully"

# Verify attestations
echo "Verifying provenance attestations..."
PACKAGE_NAME="@centrifuge/sdk-provenance-test"
PACKAGE_VERSION="0.0.0-alpha.64"

echo "Checking package: $PACKAGE_NAME@$PACKAGE_VERSION"
echo "--- Registry attestations ---"
npm view $PACKAGE_NAME@$PACKAGE_VERSION dist.attestations --json || echo "No attestations found"

echo "--- Registry signatures ---"
npm view $PACKAGE_NAME@$PACKAGE_VERSION dist.signatures --json || echo "No signatures found"

echo "---"
echo "If provenance worked, you should see attestations above and a green badge on:"
echo "https://www.npmjs.com/package/$PACKAGE_NAME/v/$PACKAGE_VERSION"
