#!/bin/bash

# Function to check if a specific label exists in a list
contains_label() {
  local label="$1"
  shift
  for item in "$@"; do
    if [[ "$item" == "$label" ]]; then
      return 0
    fi
  done
  return 1
}

# Fetch the most recent merged PR number
LAST_PR_NUMBER=$(gh pr list --state merged --json number --jq '.[0].number')

# Fetch the labels of the PR
labels=$(gh pr view "$LAST_PR_NUMBER" --json labels --jq '.labels[].name')

# Convert labels to an array
IFS=$'\n' read -rd '' -a label_array <<<"$labels"

# List of labels to check
LABELS_TO_CHECK=("major" "minor" "patch" "no-release" "alpha")

# Check for the specified labels
found_labels=0
for label in "${LABELS_TO_CHECK[@]}"; do
  if contains_label "$label" "${label_array[@]}"; then
    echo "$label"
    ((found_labels++))
  fi
done

# If more than one label is found, print an error and exit with failure
if (( found_labels > 1 )); then
  echo "Error: More than one release label found."
  exit 1
fi

# If no specified label is found, return 'no-release'
if (( found_labels == 0 )); then
  echo "no-release"
fi