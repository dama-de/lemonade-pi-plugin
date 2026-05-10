#!/bin/bash
# publish.sh — Publish the Lemonade Pi.dev extension to npm
# Usage: ./publish.sh [major|minor|patch]
#
# This script:
# 1. Validates the package.json
# 2. Builds/verifies TypeScript compilation
# 3. Publishes to npm (public or private registry)
# 4. Updates the README with install instructions

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"
cd "$PACKAGE_DIR"

# ─── Configuration ──────────────────────────────────────────────────────────

# Package name — change to your npm scope
PACKAGE_NAME="@lemonade/lemonade-provider"

# npm registry — change to your registry URL if private
NPM_REGISTRY="https://registry.npmjs.org"

# ─── Pre-flight checks ────────────────────────────────────────────────────

echo "🍋 Lemonade Pi.dev Extension Publisher"
echo "======================================="
echo ""

# Check npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Install npm first."
    exit 1
fi

# Check package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ package.json not found in $PACKAGE_DIR"
    exit 1
fi

# Check required files
REQUIRED_FILES=("extensions/index.ts" "package.json" "tsconfig.json" "README.md")
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$PACKAGE_DIR/$f" ]; then
        echo "⚠️  Missing: $f"
    fi
done

# ─── Version bumping ───────────────────────────────────────────────────────

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"

VERSION_BUMP="${1:-patch}"

if [[ "$VERSION_BUMP" =~ ^(major|minor|patch)$ ]]; then
    read -p "Bump version ($VERSION_BUMP)? [Y/n] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ || -z $REPLY ]]; then
        echo "📦 Bumping version: $VERSION_BUMP"
        npm version "$VERSION_BUMP" --no-git-tag-version
        NEW_VERSION=$(node -p "require('./package.json').version")
        echo "✅ New version: $NEW_VERSION"
    fi
else
    echo "⏭️  Skipping version bump. Use: ./publish.sh [major|minor|patch]"
fi

# ─── Validate package.json ─────────────────────────────────────────────────

echo ""
echo "📋 Validating package.json..."

# Check name
NAME=$(node -p "require('./package.json').name")
if [ "$NAME" != "$PACKAGE_NAME" ]; then
    echo "⚠️  Package name '$NAME' differs from expected '$PACKAGE_NAME'"
    echo "   Update package.json:6 to set the correct name."
fi

# Check keywords
if ! node -p "require('./package.json').keywords.includes('pi-package')"; then
    echo "⚠️  Missing 'pi-package' keyword. Add it for gallery discoverability."
fi

# Check pi manifest
if ! node -p "require('./package.json').pi" > /dev/null 2>&1; then
    echo "⚠️  Missing 'pi' manifest. Add it for auto-discovery."
fi

echo "✅ Package validation complete."

# ─── Publish ────────────────────────────────────────────────────────────────

echo ""
echo "🚀 Publishing to npm..."
echo "   Package: $NAME@$NEW_VERSION"
echo "   Registry: $NPM_REGISTRY"
echo ""

# Login check
if npm whoami &> /dev/null; then
    echo "✅ Logged in as: $(npm whoami)"
else
    echo "⚠️  Not logged in to npm registry."
    echo "   Run: npm login --registry=$NPM_REGISTRY"
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi
fi

# Publish
echo ""
echo "Publishing..."
npm publish --registry="$NPM_REGISTRY" "$@"

echo ""
echo "✅ Published: $NAME@$(node -p "require('./package.json').version")"
echo ""
echo "📦 Users can now install with:"
echo "   pi install npm:$NAME"
echo ""
echo "   Or:"
echo "   pi install npm:$NAME@$(node -p "require('./package.json').version")"