#!/bin/bash

# Generate app icons from source icon.png
# Requires: ImageMagick (for .icns and .ico generation) or ffmpeg

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SOURCE_ICON="$PROJECT_DIR/images/icon.png"
BUILD_DIR="$PROJECT_DIR/build"

echo "Generating app icons from $SOURCE_ICON"

# Create build directory if it doesn't exist
mkdir -p "$BUILD_DIR"

# Check if source icon exists
if [ ! -f "$SOURCE_ICON" ]; then
    echo "Error: Source icon not found at $SOURCE_ICON"
    exit 1
fi

# Check for required tools
if command -v magick &> /dev/null; then
    echo "Using ImageMagick for icon generation..."
    USE_MAGICK=true
elif command -v convert &> /dev/null; then
    echo "Using ImageMagick (legacy) for icon generation..."
    USE_MAGICK=true
elif command -v ffmpeg &> /dev/null; then
    echo "Using ffmpeg for icon generation..."
    USE_MAGICK=false
else
    echo "Error: Neither ImageMagick nor ffmpeg found. Please install one of them:"
    echo "  brew install imagemagick  (recommended)"
    echo "  brew install ffmpeg"
    exit 1
fi

# Function to resize icon using appropriate tool
resize_icon() {
    local input=$1
    local output=$2
    local size=$3

    if [ "$USE_MAGICK" = true ]; then
        if command -v magick &> /dev/null; then
            magick "$input" -resize "${size}x${size}" "$output"
        else
            convert "$input" -resize "${size}x${size}" "$output"
        fi
    else
        ffmpeg -y -i "$input" -vf "scale=${size}:${size}" "$output" -loglevel error
    fi
}

# ===== macOS .icns =====
echo "Generating macOS .icns file..."

ICONSET_DIR="$BUILD_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

# Generate all required macOS icon sizes
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_16x16.png" 16
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_16x16@2x.png" 32
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_32x32.png" 32
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_32x32@2x.png" 64
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_128x128.png" 128
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_128x128@2x.png" 256
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_256x256.png" 256
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_256x256@2x.png" 512
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_512x512.png" 512
resize_icon "$SOURCE_ICON" "$ICONSET_DIR/icon_512x512@2x.png" 1024

# Convert iconset to icns
if command -v iconutil &> /dev/null; then
    iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"
    echo "✓ Generated icon.icns"
else
    echo "⚠ Warning: iconutil not found (macOS only). Skipping .icns generation."
fi

# Clean up iconset directory
rm -rf "$ICONSET_DIR"

# ===== Windows .ico =====
echo "Generating Windows .ico file..."

if [ "$USE_MAGICK" = true ]; then
    # ImageMagick can create multi-resolution .ico files
    if command -v magick &> /dev/null; then
        magick "$SOURCE_ICON" -define icon:auto-resize=256,128,96,64,48,32,16 "$BUILD_DIR/icon.ico"
    else
        convert "$SOURCE_ICON" -define icon:auto-resize=256,128,96,64,48,32,16 "$BUILD_DIR/icon.ico"
    fi
    echo "✓ Generated icon.ico"
else
    # ffmpeg can only create single-resolution .ico, so we'll use 256x256
    ffmpeg -y -i "$SOURCE_ICON" -vf "scale=256:256" "$BUILD_DIR/icon.ico" -loglevel error
    echo "✓ Generated icon.ico (single resolution - consider using ImageMagick for multi-resolution)"
fi

# ===== Linux .png =====
echo "Generating Linux icon files..."

# Linux typically uses various PNG sizes
mkdir -p "$BUILD_DIR/icons"

for size in 16 32 48 64 128 256 512 1024; do
    resize_icon "$SOURCE_ICON" "$BUILD_DIR/icons/${size}x${size}.png" $size
done

# Main icon.png for electron-builder
cp "$SOURCE_ICON" "$BUILD_DIR/icon.png"
echo "✓ Generated Linux PNG icons"

echo ""
echo "✅ Icon generation complete!"
echo "Generated files in $BUILD_DIR:"
ls -lh "$BUILD_DIR"/icon.* 2>/dev/null || true
echo ""
echo "Icon sizes in $BUILD_DIR/icons:"
ls -lh "$BUILD_DIR/icons" 2>/dev/null || true
