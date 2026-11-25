#!/usr/bin/env bash
# Rebuild the single-file app and publish it to the gh-pages branch (GitHub Pages).
# Uses $GITHUB_TOKEN if set (never printed). Otherwise pushes to origin or the public repo URL.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

npm run build
if [ ! -f dist/index.html ]; then
  echo "dist/index.html was not built" >&2
  exit 1
fi

WORKDIR=$(mktemp -d)
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

cp dist/index.html "$WORKDIR/index.html"
touch "$WORKDIR/.nojekyll"

REPO_URL="https://github.com/ericwang190926-dev/products.git"
PUSH_URL="$REPO_URL"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  PUSH_URL="https://x-access-token:${GITHUB_TOKEN}@github.com/ericwang190926-dev/products.git"
elif git remote get-url origin >/dev/null 2>&1; then
  PUSH_URL=$(git remote get-url origin)
fi

git -C "$WORKDIR" init -q
git -C "$WORKDIR" checkout -q -b gh-pages
git -C "$WORKDIR" add index.html .nojekyll
git -C "$WORKDIR" \
  -c user.name="Eric Wang" \
  -c user.email="ericwang190926-dev@users.noreply.github.com" \
  commit -q -m "Publish dieline app to GitHub Pages"

# Filter the token out of any git output
git -C "$WORKDIR" push --force "$PUSH_URL" gh-pages:gh-pages 2>&1 \
  | sed -E 's#x-access-token:[^@]+@#x-access-token:[redacted]@#g'
echo "Published https://ericwang190926-dev.github.io/products/"
