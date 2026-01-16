# MyselfMonArt Publisher - Complete System

This repository contains three integrated components for the MyselfMonArt publishing workflow.

## Quick Start

**Build everything in one command:**
```bash
npm run build:dev    # Development (localhost)
npm run build:prod   # Production (live backend)
```

**Then load from `dist/` folder:**
- Chrome Extension: Load `dist/chrome-extension/` in Chrome
- UXP Plugin: Load `dist/photoshop-uxp-plugin/` in UXP Dev Tool
- Mockup Server: Run `cd dist/mockup-server && npm start`

---

## Project Structure

```
extension-Midjourney/
├── chrome-extension/        # Source: Chrome browser extension
├── mockup-server/          # Source: Local mockup server
├── photoshop-uxp-plugin/   # Source: Photoshop UXP plugin
├── .env.development        # Dev environment config
├── .env.production         # Prod environment config
├── build.js                # Unified build script
├── package.json            # Build commands
└── dist/                   # Built output (load from here!)
    ├── chrome-extension/
    ├── mockup-server/
    └── photoshop-uxp-plugin/
```

---

## Build System

### Single Command Build

The root `build.js` script builds all three components with environment-specific configuration:

```bash
npm run build:dev     # Development build
npm run build:prod    # Production build
npm run build         # Alias for build:dev
```

### What Gets Built

**1. Chrome Extension (`dist/chrome-extension/`)**
- Replaces `CONFIG` object with environment URLs
- Copies HTML, manifest, images
- Ready to load in Chrome

**2. Photoshop UXP Plugin (`dist/photoshop-uxp-plugin/`)**
- Replaces hardcoded WebSocket URL (`ws://localhost:8081`)
- Replaces hardcoded upload URL (`http://localhost:3001`)
- Copies manifest, HTML, icons
- Ready to load in UXP Developer Tool

**3. Mockup Server (`dist/mockup-server/`)**
- Copies server files and dependencies
- Creates uploads folder
- Ready to run with `npm start`

---

## Environment Configuration

### `.env.development` (Localhost)
```env
API_URL=http://localhost:3333
MOCKUP_SERVER_URL=http://localhost:3001
WEBSOCKET_URL=ws://localhost:8081
```

### `.env.production` (Live Backend)
```env
API_URL=https://backend.myselfmonart.com
MOCKUP_SERVER_URL=http://localhost:3001
WEBSOCKET_URL=ws://localhost:8081
```

---

## Components

### 1. Chrome Extension

**Features:**
- Works on any domain (not just Midjourney)
- Searchable collection selector
- Product type selection (toile, poster, tapisserie)
- Mockup generation integration
- Image upload to backend API

**Source:** `chrome-extension/`
**Built:** `dist/chrome-extension/`

### 2. Mockup Server

**Features:**
- HTTP REST API (port 3001)
- WebSocket server (port 8081)
- Receives artwork from Chrome extension
- Communicates with Photoshop via WebSocket
- Serves generated mockup previews
- Manages temporary file storage

**Source:** `mockup-server/`
**Built:** `dist/mockup-server/`

**Dependencies:** express, cors, multer, ws

### 3. Photoshop UXP Plugin

**Features:**
- Category/subcategory mockup selection
- WebSocket connection to mockup server
- Automatic smart object replacement
- Automated layer manipulation
- Export mockup to server

**Source:** `photoshop-uxp-plugin/`
**Built:** `dist/photoshop-uxp-plugin/`

---

## Installation & Usage

### Step 1: Build All Components

```bash
# First time: install dependencies for mockup server
cd mockup-server
npm install
cd ..

# Build everything
npm run build:dev
```

### Step 2: Load Chrome Extension

1. Open Chrome: `chrome://extensions/`
2. Enable "Developer mode" (top-right toggle)
3. Click "Load unpacked"
4. Select: `dist/chrome-extension/`
5. Extension should appear as "MyselfMonArt Publisher v3.0.0"

### Step 3: Load Photoshop Plugin

1. Open Adobe UXP Developer Tool
2. Click "Add Plugin"
3. Select: `dist/photoshop-uxp-plugin/manifest.json`
4. Click "Load"
5. Open Photoshop → Plugins → Mockup Categories
6. Click "Connect to Server"

### Step 4: Start Mockup Server

```bash
cd dist/mockup-server
npm start
```

Server will start on:
- HTTP: `http://localhost:3001`
- WebSocket: `ws://localhost:8081`

### Step 5: Test the Workflow

1. Navigate to any webpage with images
2. Click Chrome extension icon
3. Select product type and collection
4. Generate mockup (Photoshop plugin must be connected)
5. Review mockups and publish

---

## Development Workflow

### Making Changes

**Edit source files** in these folders:
- `chrome-extension/` - Extension source
- `mockup-server/` - Server source
- `photoshop-uxp-plugin/` - Plugin source

**Never edit files in `dist/`!** They get overwritten on build.

### After Making Changes

```bash
# Rebuild everything
npm run build:dev

# Reload in Chrome
# Go to chrome://extensions/ → Click refresh icon ↻

# Reload in UXP Developer Tool
# Click "Reload" button

# Restart server
# Ctrl+C in terminal, then npm start again
```

---

## Architecture

```
┌─────────────────────┐
│  Chrome Extension   │ → Captures images from any webpage
│   (Any Domain)      │ → Opens publish page in new tab
└──────────┬──────────┘
           │
           ↓ HTTP (localhost:3001)
┌─────────────────────┐
│  Mockup Server      │ → HTTP API (port 3001)
│  (Node.js)          │ → WebSocket (port 8081)
└──────────┬──────────┘
           │
           ↓ WebSocket (ws://localhost:8081)
┌─────────────────────┐
│   UXP Plugin        │ → Connects via WebSocket
│   (Photoshop)       │ → Generates mockups
│                     │ → Uploads results to server
└─────────────────────┘
           │
           ↓ HTTP Upload (localhost:3001)
┌─────────────────────┐
│  Chrome Extension   │ → Displays mockup preview
│                     │ → Publishes to backend API
└─────────────────────┘
```

---

## Troubleshooting

### Build fails
- Check that `.env.development` and `.env.production` exist
- Verify `mockup-server/node_modules` exists (run `npm install` in mockup-server)

### Extension doesn't load
- Make sure you're loading `dist/chrome-extension/`, NOT `chrome-extension/`
- Check Chrome console for errors (F12)
- Rebuild: `npm run build:dev`

### UXP Plugin can't connect
- Ensure mockup server is running: `cd dist/mockup-server && npm start`
- Check WebSocket URL in built plugin: `dist/photoshop-uxp-plugin/app.js`
- Click "Connect to Server" button in plugin UI

### Mockup generation fails
- Verify Photoshop plugin is loaded and connected
- Check mockup server console for errors
- Ensure mockup PSD files have smart object layer named "Artwork"

### Error messages don't appear
- **This usually means you're loading the old extension location!**
- Remove old extension from Chrome
- Rebuild: `npm run build:dev`
- Load from `dist/chrome-extension/` (NOT root or chrome-extension/)

### Changes don't appear
- Make sure you're editing files in source folders (not in `dist/`)
- Rebuild after every change: `npm run build:dev`
- Click refresh in `chrome://extensions/`
- Hard refresh any open extension tabs (Ctrl+Shift+R)

---

## Testing

### Test Development Build

```bash
# Build
npm run build:dev

# Verify URLs in built files
grep "API_URL" dist/chrome-extension/background.js
# Should show: API_URL: 'http://localhost:3333'

grep "ws://localhost:8081" dist/photoshop-uxp-plugin/app.js
# Should show: url: 'ws://localhost:8081'
```

### Test Production Build

```bash
# Build
npm run build:prod

# Verify URLs
grep "API_URL" dist/chrome-extension/background.js
# Should show: API_URL: 'https://backend.myselfmonart.com'
```

---

## Features

### Current
- ✅ Unified build system for all components
- ✅ Environment-based configuration (dev/prod)
- ✅ Works on any domain (not just Midjourney)
- ✅ Searchable collection selector
- ✅ Product type selector (toile/poster/tapisserie)
- ✅ WebSocket real-time communication
- ✅ Full Photoshop automation (smart object replacement)
- ✅ Context-aware mockup descriptions
- ✅ Aspect ratio detection (portrait/landscape/square)
- ✅ Publish to backend API with validation

### Future
- ⏳ Batch processing support
- ⏳ Enhanced error recovery
- ⏳ Custom mockup templates

---

## Version History

### v3.0.0 (Current)
- **Unified build system** - Single command builds all components
- Environment-based configuration for all three components
- Reorganized into clean folder structure
- Collection selector with search
- Context-aware mockup descriptions
- Dynamic URL configuration (no hardcoded URLs)
- Full mockup automation with Photoshop integration

### v2.0.0
- Complete rewrite from Midjourney-specific to generic image publisher
- Added Node.js bridge server
- Works on all domains

### v1.x.x (Deprecated)
- Midjourney-specific extension

---

## Requirements

- **Chrome Extension:** Chrome v88+
- **Mockup Server:** Node.js v14+
- **Photoshop Plugin:** Adobe Photoshop 2024+ (v27.1.0+)

---

## License

MIT

---

## Support

For issues or questions:
- Check the Troubleshooting section above
- Review error messages in browser console (F12)
- Check mockup server logs
- Verify all components are built and loaded from `dist/`
