# MyselfMonArt Publisher

A Chrome extension that allows users to publish images from any webpage to MyselfMonArt with automated mockup categorization.

## Overview

This project consists of three components that work together:

1. **Chrome Extension** - Captures images from any webpage and displays a publish form
2. **Node.js Bridge Server** - Manages categories, WebSocket communication, and job orchestration
3. **UXP Plugin** - Automates mockup creation in Adobe Photoshop using smart objects

## Architecture

```
┌─────────────────────┐
│  Chrome Extension   │ → Captures first large image (>100x100px) from any webpage
│   (Any Domain)      │ → Opens publish page in new tab
└──────────┬──────────┘
           │
           ↓ HTTP Request (localhost:3001)
           │ POST /submit-job (job submission)
┌─────────────────────┐
│  Node.js Server     │ → HTTP Server (port 3001): REST API
│  (Port 3001/8081)   │ → WebSocket Server (port 8081): UXP communication
└──────────┬──────────┘
           │
           ├─→ Reads folder structure
           │   ┌─────────────────────┐
           │   │  Mockups Folder     │ → Categories (Level 1: folders)
           │   │   (Local System)    │ → Subcategories (Level 2: subfolders with PSDs)
           │   └─────────────────────┘
           │
           └─→ WebSocket (ws://localhost:8081)
               ┌─────────────────────┐
               │   UXP Plugin        │ → Connects to WebSocket server
               │   (Photoshop)       │ → Receives job messages
               │                     │ → Opens mockup PSD
               │                     │ → Downloads image from URL
               │                     │ → Replaces smart object
               │                     │ → Exports JPEG
               │                     │ → Sends completion message
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
├── server.js                  # Node.js Express + WebSocket server
├── package.json               # Node.js dependencies
├── .gitignore                 # Git ignore rules
└── mockup-categories-uxp/     # UXP plugin
    ├── manifest.json          # UXP plugin manifest
    ├── index.html             # Plugin UI
    ├── app.js                 # Plugin logic with Photoshop automation
    ├── websocket-client.js    # WebSocket client for server communication
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

### 3. UXP Plugin Setup

The UXP plugin automates mockup creation in Photoshop.

**Load in Adobe Photoshop:**

1. Install UXP Developer Tool
2. Open UXP Developer Tool
3. Click "Add Plugin"
4. Select `mockup-categories-uxp/manifest.json`
5. Click "Load"
6. Open Photoshop → Plugins → Mockup Automation
7. Click "Connect to Server" in the plugin UI
8. The plugin will connect to the WebSocket server (ws://localhost:8081)

**Usage:**

1. Make sure Photoshop is open with the plugin loaded and connected
2. Use the Chrome extension to select an image and mockup
3. Click "Publier" to submit the job
4. The plugin will automatically:
   - Receive the job via WebSocket
   - Open the selected mockup PSD
   - Download the image from the URL
   - Replace the smart object layer with the new image
   - Flatten and export as JPEG
   - Send completion message back to the extension
5. Check the plugin logs to monitor progress

## Features

### Current
- ✅ Works on **any domain** (not just Midjourney)
- ✅ Captures first large image from any webpage
- ✅ Beautiful gradient UI with publish form
- ✅ Categories loaded dynamically from local mockups folder
- ✅ Node.js server reads folder structure (2 levels: categories/subcategories)
- ✅ Background script acts as proxy for API calls
- ✅ WebSocket server for real-time UXP plugin communication
- ✅ UXP plugin with full Photoshop automation
- ✅ Automated mockup creation (downloads image, replaces smart object, exports JPEG)
- ✅ Aspect ratio detection (portrait/landscape/square)
- ✅ Visual mockup selector with preview images
- ✅ Job submission and completion tracking

### Future
- ⏳ Actual publishing to backend API
- ⏳ File cleanup (delete processed images after upload)
- ⏳ Progress indicators during mockup processing
- ⏳ Batch processing support

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
8. Categories populate the dropdown and modal
9. User selects mockup and clicks "Publier"
10. `publish.js` sends job message to `background.js`
11. `background.js` POSTs job to `/submit-job` endpoint
12. Server forwards job to UXP plugin via WebSocket
13. UXP plugin processes mockup and sends completion message
14. Server returns result to extension
15. Extension displays success/error message

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

### WebSocket Communication

**Server Side (Node.js):**
- WebSocket server on port 8081 using `ws` library
- Manages single UXP plugin connection
- Tracks pending jobs with Promise-based callbacks
- Forwards job requests from HTTP endpoint to WebSocket
- Handles `job_completed` and `job_failed` responses

**Message Types:**
```javascript
{
  type: 'connected',          // Server acknowledges connection
}
{
  type: 'new_job',            // New mockup job
  job: {
    id: 'job_123...',
    imageUrl: 'https://...',
    mockupPath: 'C:\\...\\portrait.psd',
    category: 'Salon',
    subcategory: 'buffet-chene-lampe',
    layout: 'portrait'
  }
}
{
  type: 'job_completed',      // Job finished successfully
  jobId: 'job_123...',
  resultPath: '/processed/job_123.jpg'
}
{
  type: 'job_failed',         // Job failed
  jobId: 'job_123...',
  error: 'Error message'
}
```

### UXP Plugin

**Implementation:**
- WebSocket client connects to ws://localhost:8081
- Automatic reconnection with exponential backoff (max 5 attempts)
- Receives jobs via WebSocket messages
- Uses Photoshop DOM API for automation
- Smart object detection and replacement
- JPEG export with quality 12

**Automation Workflow:**
1. Receive job via WebSocket
2. Open mockup PSD from file path
3. Verify smart object layer named "Artwork" exists (case-insensitive)
4. Download image from URL to temp folder
5. Replace smart object content using batchPlay API
6. Flatten document
7. Export as JPEG
8. Close document without saving PSD
9. Send completion message

**Important:** Mockup PSD files MUST contain a smart object layer named "Artwork" (case-insensitive: "artwork", "ARTWORK", "Artwork", etc.)

**Error Handling:**
- All errors caught and sent back as `job_failed` messages
- Document always closed even if error occurs
- Timeout after 2 minutes on server side

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

### UXP Plugin not connecting

**Error:** Plugin shows "Disconnected" status

**Solution:**
1. Make sure Node.js server is running (WebSocket server starts automatically)
2. Check server console for WebSocket connection messages
3. In Photoshop, click "Connect to Server" button in the plugin
4. Verify no firewall is blocking port 8081

### Job submission fails

**Error:** "UXP plugin is not connected"

**Solution:**
1. Open Photoshop and load the UXP plugin
2. Click "Connect to Server" in the plugin
3. Wait for "Connected" status before submitting jobs
4. Check plugin logs for connection errors

### Mockup processing fails

**Error:** "Smart object 'Artwork' not found"

**Solution:**
1. Verify mockup PSD has a smart object layer named "Artwork" (case-insensitive)
2. The layer name must be exactly "Artwork" - can be "artwork", "ARTWORK", "Artwork", etc.
3. If the error message lists other smart objects found, rename one of them to "Artwork"
4. Check plugin logs for the full layer path (e.g., "Group 1 > Artwork")

**Common mistakes:**
- Layer is named "Art" or "Image" instead of "Artwork"
- Layer is a regular layer, not a smart object
- Typo in layer name (e.g., "Artowrk", "Art work")

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

### v3.0.0 (Current)
- Full mockup automation with Photoshop integration
- WebSocket server for real-time UXP plugin communication
- Automated smart object replacement and JPEG export
- Aspect ratio detection (portrait/landscape/square)
- Visual mockup selector with preview images
- Product type selector (toile/poster/tapisserie)
- Job submission and completion tracking

### v2.0.0
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
