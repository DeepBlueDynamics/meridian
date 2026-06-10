#!/bin/bash
set -e

# S-57 ENC to PMTiles Vector Tiles Conversion Pipeline
# Reusable tooling for packaging nautical charts for offline-first marine nav.

echo "=========================================================="
echo "   S-57 ENC to PMTiles Conversion Pipeline"
echo "=========================================================="

# 1. Dependency Checks & Installation
echo "Step 1: Checking dependencies..."
if ! command -v ogr2ogr &> /dev/null; then
    echo "GDAL (ogr2ogr) not found. Installing gdal-bin..."
    apt-get update && apt-get install -y gdal-bin
fi

if ! command -v tippecanoe &> /dev/null; then
    echo "Tippecanoe not found. Building and installing Felt Tippecanoe from source..."
    apt-get update && apt-get install -y build-essential libsqlite3-dev zlib1g-dev git
    
    # Temporary build directory
    BUILD_DIR=$(mktemp -d)
    echo "Cloning felt/tippecanoe to $BUILD_DIR..."
    git clone https://github.com/felt/tippecanoe.git "$BUILD_DIR"
    
    cd "$BUILD_DIR"
    echo "Compiling Tippecanoe..."
    make -j$(nproc)
    echo "Installing Tippecanoe..."
    make install
    
    # Clean up
    cd -
    rm -rf "$BUILD_DIR"
    echo "Tippecanoe installed successfully!"
fi

# 2. Input/Output Setup
INPUT_DIR=${1:-"./enc_charts"}
OUTPUT_FILE=${2:-"./public/charts.pmtiles"}
TEMP_GEOJSON_DIR=$(mktemp -d)

mkdir -p "$INPUT_DIR"
mkdir -p "$(dirname "$OUTPUT_FILE")"

# If input directory is empty, download a sample NOAA chart for San Diego Bay
if [ -z "$(ls -A "$INPUT_DIR")" ]; then
    echo "Input directory '$INPUT_DIR' is empty."
    echo "Downloading sample San Diego Bay ENC chart (US5CA90M) from NOAA..."
    
    SAMPLE_ZIP="$INPUT_DIR/US5CA90M.zip"
    curl -L -o "$SAMPLE_ZIP" "https://www.charts.noaa.gov/ENCs/US5CA90M.zip" || {
        echo "Failed to download chart zip from NOAA."
    }
    
    if [ -f "$SAMPLE_ZIP" ]; then
        echo "Unpacking downloaded chart zip..."
        unzip -d "$INPUT_DIR" "$SAMPLE_ZIP"
        rm -f "$SAMPLE_ZIP"
    fi
fi

# Find all S-57 .000 chart files
S57_FILES=$(find "$INPUT_DIR" -name "*.000")

if [ -z "$S57_FILES" ]; then
    echo "Error: No S-57 .000 files found in '$INPUT_DIR'!"
    exit 1
fi

echo "Found S-57 files to process:"
echo "$S57_FILES"

# 3. Layer Separation & Conversion to GeoJSON
# Splitting S-57 objects into separate files so Tippecanoe names layers accordingly.
S57_LAYERS=(
    "DEPARE" "DEPCNT" "SOUNDG" "BOYSPP" "BOYLAT" 
    "LNDARE" "COALNE" "SEAARE" "LIGHTS" "RESARE" 
    "NAVNEP" "OBSTRN" "UWTROC" "WRECKS"
)

echo "Step 2: Extracting S-57 layers to GeoJSON..."
for file in $S57_FILES; do
    echo "Processing cell: $(basename "$file")"
    
    for layer in "${S57_LAYERS[@]}"; do
        # Extract individual layer with standard S-57 open options
        ogr2ogr -f GeoJSON "$TEMP_GEOJSON_DIR/${layer}_$(basename "$file").geojson" "$file" "$layer" \
            -oo RETURN_PRIMITIVES=ON \
            -oo RETURN_LINKAGES=ON \
            -oo LNAM_REFS=ON \
            -oo SPLIT_MULTIPOINT=ON \
            -oo ADD_SOUNDG_DEPTH=ON 2>/dev/null || true # Layer might not exist in this cell
    done
done

# Merge layer parts by name
echo "Step 3: Merging layer datasets..."
MERGED_DIR=$(mktemp -d)
for layer in "${S57_LAYERS[@]}"; do
    LAYER_PARTS=()
    for part in $(find "$TEMP_GEOJSON_DIR" -name "${layer}_*.geojson"); do
        if [ -s "$part" ]; then
            LAYER_PARTS+=("$part")
        fi
    done

    if [ ${#LAYER_PARTS[@]} -gt 0 ]; then
        echo "Merging part files for layer: $layer"
        # Combine parts into a single layer GeoJSON
        ogr2ogr -f GeoJSON "$MERGED_DIR/${layer}.geojson" "${LAYER_PARTS[0]}"
        for ((i=1; i<${#LAYER_PARTS[@]}; i++)); do
            ogr2ogr -f GeoJSON -update -append "$MERGED_DIR/${layer}.geojson" "${LAYER_PARTS[$i]}"
        done
    fi
done

# 4. Tippecanoe Compilation to PMTiles
echo "Step 4: Compiling GeoJSON layers to PMTiles..."
# Compiles each merged GeoJSON file into a separate vector tile layer in the PMTiles archive
tippecanoe -o "$OUTPUT_FILE" \
    -zg \
    --projection=EPSG:4326 \
    --force \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    "$MERGED_DIR"/*.geojson

# Cleanup temp files
rm -rf "$TEMP_GEOJSON_DIR"
rm -rf "$MERGED_DIR"

echo "=========================================================="
echo "   Conversion Complete!"
echo "   Output PMTiles saved to: $OUTPUT_FILE"
echo "=========================================================="
