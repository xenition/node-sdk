#!/bin/bash
#
# Patch URLs for public repo (main-branch sync only).
#
# Replaces the develop-branch API URL (api-dev.xenition.com) with the
# production URL (api.xenition.com) in src/constants.ts. Called from
# .github/workflows/publish-sdk.yml on main-branch pushes only.
#
# On the develop branch: no-op. On main: the sed runs before the file
# is rsync'd to the public xenition/node-sdk repo.

set -e

echo "Checking if URL patching is needed..."

BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")
echo "Current branch: $BRANCH"

OLD_URL="https://api-dev.xenition.com/v1"

if [ "$BRANCH" = "develop" ]; then
  echo "Develop branch — no URL patching needed. Keeping development API URL."
  exit 0
elif [ "$BRANCH" = "main" ]; then
  NEW_URL="https://api.xenition.com/v1"
  echo "Main branch — patching development → production API URL."
  echo "  Old: $OLD_URL"
  echo "  New: $NEW_URL"
else
  echo "Branch '$BRANCH' — no URL patching needed."
  exit 0
fi

patch_file() {
  local file=$1
  if [ -f "$file" ]; then
    echo "Patching $file..."
    cp "$file" "$file.bak"
    sed -i.tmp "s|${OLD_URL}|${NEW_URL}|g" "$file"
    rm -f "$file.tmp"
    rm -f "$file.bak"
  fi
}

# Source file (what devs edit)
patch_file "src/constants.ts"

# Compiled outputs (what gets published via the `dist/` folder)
patch_file "dist/constants.js"
patch_file "dist/constants.d.ts"

echo "Done."
