# Meridian Terminal

Maritime chart application with 2D/3D views, OpenSeaMap integration, and terrain visualization.

## Prerequisites

- Node.js 18+ (recommend using `nvm` or `fnm`)
- npm (comes with Node.js)

### macOS Setup

```bash
# Install Node.js via Homebrew
brew install node

# Or use nvm (recommended)
brew install nvm
nvm install 20
nvm use 20
```

## Installation

```bash
# Clone and enter directory
cd meridian-terminal

# Install dependencies
npm install
```

## Running

### Development (Browser)

```bash
npm run dev
```

Opens at http://localhost:5173

### Development (Electron Desktop App)

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron (after Vite is running)
npm run dev:electron

# Or run both together:
npm run dev:full
```

### Production Build

```bash
# Build web assets
npm run build

# Build Electron app (creates distributable)
npm run build:electron
```

## Features

- **2D Map**: Leaflet with OpenStreetMap + OpenSeaMap overlays
- **3D Map**: MapLibre GL with terrain elevation (AWS Terrain Tiles)
- **Layers**: Seamarks, Bathymetry, Satellite Imagery, Grid overlay
- **Depth Soundings**: Grid-based depth markers that reveal on hover
- **Measure Tool**: Distance measurement in nm/km/mi
- **Search**: Claude-powered geocoding (requires API key)
- **Orbit Mode**: Auto-rotate 3D view

## Environment Variables

Create a `.env` file in the project root:

```bash
# For Claude-powered search (optional)
VITE_ANTHROPIC_API_KEY=sk-ant-...
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run dev:electron` | Start Electron (requires dev server) |
| `npm run dev:full` | Start both Vite and Electron |
| `npm run build:electron` | Build Electron distributable |
| `npm run lint` | Run ESLint |

## Tech Stack

- React 19
- Vite 7
- Leaflet (2D maps)
- MapLibre GL JS (3D maps)
- Electron (desktop app)
