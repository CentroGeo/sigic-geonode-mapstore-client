#!/usr/bin/env bash
set -euo pipefail

RELEASE_BRANCH="4.4.x.sigic.whl"
BASE_VERSION="4.4.0"

BRANCH=$(git branch --show-current)
[ "$BRANCH" = "$RELEASE_BRANCH" ] || {
  echo "❌ Ejecuta desde $RELEASE_BRANCH"
  exit 1
}

# Asegurar árbol limpio
if ! git diff-index --quiet HEAD --; then
  echo "❌ Working tree sucio"
  exit 1
fi

# Calcular postN desde tags existentes
LAST_TAG=$(git tag --list "v${BASE_VERSION}.post*" --sort=-v:refname | head -n1)

if [ -z "$LAST_TAG" ]; then
  POST=1
else
  POST="${LAST_TAG##*.post}"
  POST=$((POST + 1))
fi

VERSION="${BASE_VERSION}.post${POST}"
TAG="v${VERSION}"

echo "📦 Nueva versión: $VERSION"

# Actualizar VERSION
echo "$VERSION" > VERSION

git add VERSION
git commit -m "chore(release): $VERSION"
git push origin "$RELEASE_BRANCH"

# Tag
git tag "$TAG"
git push origin "$TAG"

echo "🚀 Tag creado: $TAG"
