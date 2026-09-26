#!/usr/bin/env bash
# ==============================================================================
# Build Script for Web Audio Mastering Analyzer
# Supports standard environments & Android PRoot/FUSE storage (noexec detection)
# ==============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Building Web Audio Mastering Analyzer..."

# Check if current directory has execution permissions
TEST_FILE="$SCRIPT_DIR/.test_exec_$$"
touch "$TEST_FILE"
chmod +x "$TEST_FILE" 2>/dev/null || true

CAN_EXEC=true
if [ ! -x "$TEST_FILE" ]; then
  CAN_EXEC=false
fi
rm -f "$TEST_FILE"

if [ "$CAN_EXEC" = true ]; then
  # Standard environment (Linux / macOS / Windows native)
  echo "📦 Environment: Standard filesystem. Running direct Vite build..."
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run vite-build
else
  # Android PRoot / FUSE shared storage (noexec / nosymlink constraint)
  echo "📱 Environment: FUSE / shared storage detected. Utilizing native build workspace..."
  BUILD_DIR="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/audio-spectrum-analyzer-build"
  mkdir -p "$BUILD_DIR"

  # Copy source files to native Linux filesystem (clean copy without node_modules/dist/git)
  cp "$SCRIPT_DIR/package.json" "$BUILD_DIR/"
  cp "$SCRIPT_DIR/tsconfig.json" "$BUILD_DIR/"
  cp "$SCRIPT_DIR/vite.config.ts" "$BUILD_DIR/"
  cp "$SCRIPT_DIR/index.html" "$BUILD_DIR/"
  rm -rf "$BUILD_DIR/src"
  cp -r "$SCRIPT_DIR/src" "$BUILD_DIR/"

  cd "$BUILD_DIR"
  if [ ! -d "node_modules" ]; then
    echo "📦 Installing build dependencies in native workspace..."
    npm install
  fi
  npx vite build

  # Sync back the singlefile dist to project directory
  mkdir -p "$SCRIPT_DIR/dist"
  cp "$BUILD_DIR/dist/index.html" "$SCRIPT_DIR/dist/index.html"
  cp "$BUILD_DIR/dist/index.html" "$SCRIPT_DIR/web-audio-mastering-analyzer.html"
  echo "✅ Single-file SPA successfully built & synced to dist/index.html and web-audio-mastering-analyzer.html!"
fi
