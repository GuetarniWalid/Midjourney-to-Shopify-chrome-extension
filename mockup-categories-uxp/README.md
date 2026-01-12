# Mockup Automation UXP Plugin

A UXP plugin for Adobe Photoshop that automates mockup creation for the MyselfMonArt Publisher Chrome extension.

## Purpose

This plugin will automate the process of creating mockups in Photoshop by:
- Receiving job requests from the Node.js bridge server
- Opening the appropriate mockup template
- Inserting the design/image
- Saving the final mockup

**Note**: This plugin is currently a placeholder for future mockup automation functionality. The categories serving is now handled by the standalone Node.js server (`server.js` at project root).

## Architecture

```
Chrome Extension → Node.js Server (port 3001) → UXP Plugin (future)
                    ↓
                Mockups Folder
```

## Installation

1. Load in UXP Developer Tool:
   - Open UXP Developer Tool
   - Click "Add Plugin"
   - Select the `manifest.json` file
   - Click "Load"

## Usage

1. Open Photoshop
2. Go to Plugins > Mockup Automation
3. The plugin UI will be ready for future mockup automation features

## Current Status

**Phase 1** (Current): Infrastructure setup
- ✅ Chrome extension publishes images
- ✅ Node.js server reads mockups folder and serves categories
- ⏳ UXP plugin ready for future automation

**Phase 2** (Future): Mockup automation
- ⏳ Receive job requests from Node.js server
- ⏳ Open mockup templates in Photoshop
- ⏳ Insert images and create mockups
- ⏳ Save and return completed mockups

## Folder Structure

```
mockup-categories-uxp/
├── manifest.json     # UXP plugin manifest
├── index.html        # Plugin UI
├── app.js            # Plugin logic (placeholder)
├── README.md         # This file
└── icons/            # Plugin icons
    └── icon.png
```

## Integration

The Node.js server at the project root handles communication:
- Run server: `npm start` (from project root)
- Server URL: `http://localhost:3001`
- Endpoints: `/categories`, `/health`
