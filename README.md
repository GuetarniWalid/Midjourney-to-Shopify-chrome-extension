# MyselfMonArt Publisher

A Chrome extension that allows users to publish images from any webpage to MyselfMonArt with automated mockup categorization.

## Overview

This project consists of three components that work together:

1. **Chrome Extension** - Captures images from any webpage and displays a publish form
2. **Node.js Bridge Server** - Reads mockups folder structure and serves categories via REST API
3. **UXP Plugin** *(Phase 2 - Future)* - Will automate mockup creation in Adobe Photoshop

## Architecture

```
┌─────────────────────┐
│  Chrome Extension   │ → Captures first large image (>100x100px) from any webpage
│   (Any Domain)      │ → Opens publish page in new tab
└──────────┬──────────┘
           │
           ↓ HTTP Request (localhost:3001)
┌─────────────────────┐
│  Node.js Server     │ → Scans mockups folder structure
│    (Port 3001)      │ → Serves categories/subcategories via REST API
└──────────┬──────────┘
           │
           ↓ Reads folder structure
┌─────────────────────┐
│  Mockups Folder     │ → Categories (Level 1: folders)
│   (Local System)    │ → Subcategories (Level 2: subfolders)
└─────────────────────┘

┌─────────────────────┐
│   UXP Plugin        │ → (Phase 2) Will receive job requests
│   (Photoshop)       │ → (Phase 2) Automate mockup creation
└─────────────────────┘
```

## Project Structure

```
extension-Midjourney/
├── manifest.json              # Chrome extension manifest (V3)
├── background.js              # Service worker (handles icon clicks, proxy for API)
├── content.js                 # Minimal content script
├── publish.html               # Full-page publish form
├── publish.js                 # Publish form logic
├── images/                    # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── server.js                  # Node.js Express server
├── package.json               # Node.js dependencies
├── .gitignore                 # Git ignore rules
└── mockup-categories-uxp/     # UXP plugin (Phase 2 placeholder)
    ├── manifest.json          # UXP plugin manifest
    ├── index.html             # Plugin UI
    ├── app.js                 # Plugin logic (placeholder)
    ├── icons/                 # Plugin icons
    └── README.md              # UXP plugin documentation
```

## Installation & Setup

### 1. Node.js Server Setup

The server must be running for the extension to load categories.

```bash
# Install dependencies
npm install

# Start the server
npm start
```

The server will start on `http://localhost:3001` and read the mockups folder at:
```
C:\Users\gueta\Documents\Mes_projets\MyselfMonArt_Backend\photoshop-plugin\mockups
```

**Available endpoints:**
- `GET /health` - Health check
- `GET /categories` - Returns categories and subcategories

**Server Configuration:**
- Port: `3001`
- CORS: Enabled for all origins
- Mockups path: Configured in `server.js` (line 9)

### 2. Chrome Extension Setup

**Load the extension:**

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right)
3. Click "Load unpacked"
4. Select the `extension-Midjourney` folder
5. The extension icon will appear in your browser toolbar

**Usage:**

1. Navigate to any webpage with images
2. Click the extension icon in the toolbar
3. The extension will:
   - Find the first image larger than 100x100px
   - Open a new tab with the publish form
   - Load categories from the Node.js server
4. Fill in the form:
   - **Alt text**: Description for the image
   - **Category**: Select from dropdown (populated from mockups folder)
5. Click "Publier" to publish (currently in development)

### 3. UXP Plugin Setup *(Optional - Phase 2)*

The UXP plugin is currently a placeholder for future mockup automation.

**Load in Adobe Photoshop:**

1. Install UXP Developer Tool
2. Open UXP Developer Tool
3. Click "Add Plugin"
4. Select `mockup-categories-uxp/manifest.json`
5. Click "Load"
6. Open Photoshop → Plugins → Mockup Automation

The plugin displays the development roadmap and will be implemented in Phase 2.

## Features

### Current (Phase 1)
- ✅ Works on **any domain** (not just Midjourney)
- ✅ Captures first large image from any webpage
- ✅ Beautiful gradient UI with publish form
- ✅ Categories loaded dynamically from local mockups folder
- ✅ Node.js server reads folder structure (2 levels: categories/subcategories)
- ✅ Background script acts as proxy for API calls

### Future (Phase 2)
- ⏳ UXP plugin connection to Node.js server
- ⏳ Automated mockup creation in Photoshop
- ⏳ Job queue system for batch processing
- ⏳ Actual publishing to backend API

## Technical Details

### Chrome Extension

**Manifest V3:**
- Service worker instead of background page
- `scripting` permission for finding images
- `storage` permission for passing data between pages
- `host_permissions` for localhost API access

**Communication Flow:**
1. User clicks extension icon
2. `background.js` executes script in current tab to find first large image
3. Image URL stored in `chrome.storage.local`
4. New tab opens with `publish.html`
5. `publish.js` retrieves image from storage
6. `publish.js` sends message to `background.js` to fetch categories
7. `background.js` fetches from Node.js server and returns data
8. Categories populate the dropdown

**Why background script proxy?**
Extension pages cannot directly access `localhost` due to security restrictions. The background service worker acts as a proxy.

### Node.js Server

**Technology Stack:**
- Express.js - Web framework
- CORS - Cross-origin resource sharing
- Node.js fs/promises - Async file system operations

**Folder Scanning Logic:**
1. Reads top-level folders (categories)
2. For each category, reads subfolders (subcategories)
3. Returns JSON structure:
   ```json
   {
     "success": true,
     "categories": [
       {
         "name": "CategoryName",
         "subcategories": ["Sub1", "Sub2", "Sub3"]
       }
     ]
   }
   ```

### UXP Plugin

**Current Status:**
- Placeholder UI showing development roadmap
- No functionality in Phase 1
- Ready for Phase 2 implementation

**Future Implementation:**
- WebSocket or HTTP client to connect to Node.js server
- Photoshop DOM API for mockup automation
- Image loading and smart object replacement
- Export and save functionality

## Development

### Modifying Mockups Path

Edit `server.js` line 9:
```javascript
const MOCKUPS_PATH = 'C:\\Users\\gueta\\Documents\\Mes_projets\\MyselfMonArt_Backend\\photoshop-plugin\\mockups';
```

### Modifying Server Port

Edit `server.js` line 8:
```javascript
const PORT = 3001;
```

Also update in:
- `background.js` line 2
- `publish.js` line 4

### Extension Development

After making changes to the extension:
1. Go to `chrome://extensions/`
2. Click the refresh icon on the extension card
3. Reload any open tabs where the extension is active

### Testing

**Test server manually:**
```bash
# Health check
curl http://localhost:3001/health

# Get categories
curl http://localhost:3001/categories
```

**Test extension:**
1. Visit any website with images
2. Click extension icon
3. Verify publish page opens
4. Verify image is displayed
5. Verify categories load in dropdown

## Troubleshooting

### Categories not loading

**Error:** "Erreur: Le serveur UXP est-il démarré?"

**Solution:**
1. Make sure Node.js server is running: `npm start`
2. Verify server is accessible: `curl http://localhost:3001/health`
3. Check console for errors in publish page (F12)

### No image found

The extension looks for images larger than 100x100px. If no image is found:
- Try a page with larger images
- The placeholder "No image found" will be displayed

### Server won't start

**Error:** Port already in use

**Solution:**
1. Check if another process is using port 3001
2. Kill the process or change the port in `server.js`

## Version History

### v2.0.0 (Current)
- Complete rewrite from Midjourney-specific to generic image publisher
- Added Node.js bridge server
- Removed all Midjourney-specific code
- Changed from popup modal to full-page publish form
- Works on all domains

### v1.x.x (Deprecated)
- Midjourney-specific extension
- Logo overlay functionality
- Direct button integration

## License

MIT

## Contributing

This is a private project for MyselfMonArt. Phase 2 will implement the UXP plugin for automated mockup generation.
