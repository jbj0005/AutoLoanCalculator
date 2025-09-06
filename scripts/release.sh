#!/usr/bin/env bash
set -euo pipefail

if [[ ${1:-} == "" ]]; then
  echo "Usage: scripts/release.sh vX.Y.Z [--tag]" >&2
  exit 1
fi

VERSION="$1"; shift || true
TAG=false
if [[ ${1:-} == "--tag" ]]; then TAG=true; fi

if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must look like v0.0.0" >&2
  exit 1
fi

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

DATE=$(date +%Y-%m-%d)

echo "Bumping version to $VERSION"

# Safe in-place replace helper (portable sed -i)
replace() {
  local pattern="$1" file="$2"
  local tmp="$file.tmp.$$"
  sed -E "$pattern" "$file" > "$tmp" && mv "$tmp" "$file"
}

# Update config.js APP_VERSION
if grep -q "window.APP_VERSION" config.js 2>/dev/null; then
  replace "s/(window\.APP_VERSION\s*=\s*)\"[^\"]*\";/\\1\"$VERSION\";/" config.js
else
  echo "window.APP_VERSION = \"$VERSION\";" >> config.js
fi

# Update version pill fallback in index.html (runtime will also set from APP_VERSION)
replace "s/(<div id=\"version\" class=\"pill version\">)v[0-9]+\.[0-9]+\.[0-9]+(<\/div>)/\\1$VERSION\\2/" index.html || true

# Update README heading
replace "s/^(# Auto Loan Calculator \(GitHub Pages\) — )v[0-9]+\.[0-9]+\.[0-9]+$/\\1$VERSION/" README.md || true

# Prepare release notes skeleton
mkdir -p RELEASE_NOTES
NOTES_FILE="RELEASE_NOTES/$VERSION.md"
if [[ ! -f "$NOTES_FILE" ]]; then
  cat > "$NOTES_FILE" <<EOF
# Auto Loan Calculator $VERSION — $DATE

Highlights
- TBD

Details
- TBD

Upgrade Notes
- No breaking changes.

EOF
fi

git add config.js index.html README.md "$NOTES_FILE"
git commit -m "chore: bump to $VERSION" || echo "Nothing to commit (already at $VERSION)"

if $TAG; then
  git tag -a "$VERSION" -m "Release $VERSION" || true
  git push origin HEAD
  git push origin "$VERSION"
  echo "Tagged and pushed $VERSION"
else
  echo "Committed bump. To tag: git tag -a $VERSION -m 'Release $VERSION' && git push origin HEAD --tags"
fi

echo "Done."

