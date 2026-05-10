#!/bin/bash
# install.sh — Install the Lemonade Pi.dev extension
# Usage: ./install.sh
#
# This script:
# 1. Creates the Pi extensions directory if needed
# 2. Symlinks (or copies) this extension into place
# 3. Verifies the installation
# 4. Shows the user how to connect

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXTENSION_DIR="$(cd "$SCRIPT_DIR/../" && pwd)"
PI_EXTENSIONS_DIR="$HOME/.pi/agent/extensions"
LEMONADE_EXT="$PI_EXTENSIONS_DIR/lemonade-provider"

echo "🍋 Lemonade Pi.dev Extension Installer"
echo "======================================="
echo ""

# Check if Pi is installed
if ! command -v pi &> /dev/null; then
    echo "⚠️  Pi.dev is not installed."
    echo "   Install it first: npm install -g @earendil-works/pi-coding-agent"
    echo ""
    echo "   After installing Pi, run this script again."
    exit 1
fi

echo "✅ Pi.dev found: $(which pi)"
echo ""

# Create extensions directory
mkdir -p "$PI_EXTENSIONS_DIR"
echo "📁 Extensions directory: $PI_EXTENSIONS_DIR"

# Check if already installed
if [ -L "$LEMONADE_EXT" ]; then
    CURRENT_TARGET=$(readlink "$LEMONADE_EXT")
    echo "📌 Extension is symlinked from: $CURRENT_TARGET"
    if [ "$CURRENT_TARGET" = "$EXTENSION_DIR" ]; then
        echo "✅ Extension is already up to date!"
    else
        echo "🔄 Updating symlink..."
        rm -f "$LEMONADE_EXT"
        ln -s "$EXTENSION_DIR" "$LEMONADE_EXT"
        echo "✅ Symlink updated."
    fi
elif [ -d "$LEMONADE_EXT" ]; then
    echo "📁 Extension directory exists (not a symlink)."
    read -p "Replace with symlink? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm -rf "$LEMONADE_EXT"
        ln -s "$EXTENSION_DIR" "$LEMONADE_EXT"
        echo "✅ Replaced with symlink."
    else
        echo "Keeping existing directory."
    fi
else
    # Create symlink
    ln -s "$EXTENSION_DIR" "$LEMONADE_EXT"
    echo "✅ Extension symlinked: $LEMONADE_EXT → $EXTENSION_DIR"
fi

echo ""
echo "📋 Installation Summary"
echo "───────────────────────"
echo "Extension: $LEMONADE_EXT"
echo "Source:    $EXTENSION_DIR"
echo ""

# Verify the extension files
if [ -f "$LEMONADE_EXT/extensions/index.ts" ] && [ -f "$LEMONADE_EXT/package.json" ]; then
    echo "✅ Extension files verified."
else
    echo "⚠️  Some extension files are missing. Check the installation."
fi

echo ""
echo "🚀 Next Steps"
echo "───────────────────────"
echo "1. Start Pi:"
echo "   pi"
echo ""
echo "2. In Pi, type:"
echo "   /login"
echo ""
echo "3. Follow the guided setup to connect to your Lemonade server."
echo ""
echo "Or connect directly:"
echo "   /login connect        # Auto-detect local server"
echo "   /login apply <url>    # Connect to specific server"
echo ""
echo "📖 Full documentation:"
echo "   $EXTENSION_DIR/README.md"