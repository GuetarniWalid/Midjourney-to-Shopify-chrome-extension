# Complete Extension Reload Checklist

## The Problem
Error messages don't appear when mockup server isn't running = Old extension still loaded

## The Fix (Follow EXACTLY in order)

### Step 1: Remove ALL Old Extensions

1. Open Chrome: `chrome://extensions/`
2. Look for **"MyselfMonArt Publisher"** or any extension from this project
3. Click **"Remove"** button (trash icon)
4. If you see multiple extensions with similar names, **remove ALL of them**

### Step 2: Close ALL Extension Tabs

1. Close any tabs that have the extension open (publish pages)
2. Close any tabs showing `chrome://extensions/`
3. Restart Chrome (completely close and reopen)

### Step 3: Rebuild the Project

```bash
# Make sure you're in the project root
cd C:\Users\gueta\Documents\Mes_projets\extension-Midjourney

# Rebuild
npm run build:dev
```

**VERIFY the build output shows:**
```
✅ BUILD COMPLETE!
📁 Output: ./dist/ folder
```

### Step 4: Load Extension from CORRECT Location

1. Open Chrome again: `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Navigate to: `C:\Users\gueta\Documents\Mes_projets\extension-Midjourney\dist\chrome-extension\`

   **⚠️ CRITICAL:** Select the `chrome-extension` folder INSIDE `dist`
   - ✅ CORRECT: `.../extension-Midjourney/dist/chrome-extension/`
   - ❌ WRONG: `.../extension-Midjourney/chrome-extension/`
   - ❌ WRONG: `.../extension-Midjourney/dist/`

5. Click "Select Folder"

### Step 5: Verify Extension Info

Check the extension card shows:
- **Name:** MyselfMonArt Publisher
- **Version:** 3.0.0
- **ID:** (random characters - this is normal)
- **Location:** Should end with `.../dist/chrome-extension`

**Screenshot the location if you're not sure!**

### Step 6: Test Error Handling

1. **CLOSE ALL TABS** (especially any extension tabs)
2. Open a new tab
3. Go to any website with images (e.g., https://unsplash.com)
4. Click the extension icon (purple icon in toolbar)
5. A new tab should open with the publish page
6. Try to click "Ajouter un mockup" (Add mockup button)
7. Select any mockup

**Expected behavior WITHOUT server:**
- A popup error should appear saying: "Erreur: Aucune réponse du serveur"
- OR: A fetch error related to connection

**If NO error appears:**
- Extension is still loading from wrong location
- Go back to Step 1 and start over

### Step 7: Test WITH Server (Optional)

1. Start the server:
   ```bash
   cd dist/mockup-server
   npm start
   ```

2. **WITHOUT connecting Photoshop plugin**, try to generate mockup again

3. **Expected error:**
   ```
   Le plugin Photoshop n'est pas connecté.

   Veuillez:
   1. Ouvrir Photoshop
   2. Ouvrir le plugin UXP
   3. Cliquer sur "Connect to Server"
   ```

## Debugging Tips

### How to check where Chrome loaded the extension from:

1. In `chrome://extensions/`, click "Details" on the extension
2. Scroll to "Path"
3. It should show: `.../extension-Midjourney/dist/chrome-extension`

### How to check if CONFIG is correct:

1. In `chrome://extensions/`, turn on "Developer mode"
2. Click "background.html" or "service worker" link
3. In the console, type: `CONFIG`
4. Press Enter
5. You should see:
   ```javascript
   {
     API_URL: 'http://localhost:3333',
     MOCKUP_SERVER_URL: 'http://localhost:3001'
   }
   ```

### Force Chrome to reload everything:

1. In `chrome://extensions/`, click the refresh icon ↻ on the extension
2. Close ALL tabs
3. Restart Chrome completely
4. Test again

## Still Not Working?

Share this information:

1. **Extension location from Details page:** (screenshot)
2. **Console errors:** Press F12 on extension page, check Console tab
3. **Network errors:** Press F12, go to Network tab, try to generate mockup, share failed requests

The issue is 99% that the old extension is still loaded from the wrong location!
