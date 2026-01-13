/****************************************************************/
/*                    MOCKUP AUTOMATION PLUGIN                  */
/****************************************************************/

// Wait for DOM to be fully loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadWebSocketClient);
} else {
  loadWebSocketClient();
}

function loadWebSocketClient() {
  // Load WebSocket client
  const script = document.createElement('script');
  script.src = './websocket-client.js';
  document.head.appendChild(script);

  // Wait for WebSocket client to load
  script.onload = function() {
    init();
  };
}


/****************************************************************/
/*                    UI ELEMENTS                               */
/****************************************************************/

let statusIndicator;
let statusText;
let connectBtn;
let logsContainer;
let clearLogsBtn;
let jobsReceivedEl;
let jobsCompletedEl;


/****************************************************************/
/*                    STATE                                     */
/****************************************************************/

let jobsReceived = 0;
let jobsCompleted = 0;
let wsClient = null;


/****************************************************************/
/*                    INITIALIZATION                            */
/****************************************************************/

/**
 * Initialize the plugin
 */
function init() {
  console.log('[UXP] Initializing plugin...');

  // Get UI elements
  statusIndicator = document.getElementById('statusIndicator');
  statusText = document.getElementById('statusText');
  connectBtn = document.getElementById('connectBtn');
  logsContainer = document.getElementById('logsContainer');
  clearLogsBtn = document.getElementById('clearLogsBtn');
  jobsReceivedEl = document.getElementById('jobsReceived');
  jobsCompletedEl = document.getElementById('jobsCompleted');

  console.log('[UXP] UI elements:', {
    statusIndicator: !!statusIndicator,
    statusText: !!statusText,
    connectBtn: !!connectBtn,
    logsContainer: !!logsContainer,
    clearLogsBtn: !!clearLogsBtn,
    jobsReceivedEl: !!jobsReceivedEl,
    jobsCompletedEl: !!jobsCompletedEl
  });

  // Check if WebSocketClient is loaded
  if (typeof WebSocketClient === 'undefined') {
    console.error('[UXP] WebSocketClient is not defined!');
    addLog('error', 'WebSocketClient failed to load');
    return;
  }
  console.log('[UXP] WebSocketClient loaded successfully');

  // Setup event listeners
  connectBtn.addEventListener('click', handleConnectClick);
  clearLogsBtn.addEventListener('click', clearLogs);

  console.log('[UXP] Event listeners attached');
  addLog('info', 'Plugin initialized. Click "Connect to Server" to start.');
}


/****************************************************************/
/*                    CONNECTION HANDLING                       */
/****************************************************************/

/**
 * Handle connect/disconnect button click
 */
function handleConnectClick() {
  console.log('[UXP] Connect button clicked');
  addLog('info', 'Connect button clicked');

  if (wsClient && wsClient.isConnected()) {
    console.log('[UXP] Disconnecting...');
    // Disconnect
    wsClient.disconnect();
    wsClient = null;
  } else {
    console.log('[UXP] Connecting to server...');
    // Connect
    connectToServer();
  }
}

/**
 * Connect to WebSocket server
 */
function connectToServer() {
  console.log('[UXP] Creating WebSocket client...');
  addLog('info', 'Creating WebSocket connection...');

  try {
    wsClient = new WebSocketClient({
      url: 'ws://localhost:8081',
      onConnect: handleConnect,
      onDisconnect: handleDisconnect,
      onMessage: handleMessage,
      onError: handleError,
      onLog: addLog,
    });

    console.log('[UXP] WebSocket client created, calling connect()...');
    wsClient.connect();
  } catch (error) {
    console.error('[UXP] Error creating WebSocket client:', error);
    addLog('error', 'Failed to create WebSocket: ' + error.message);
  }
}

/**
 * Handle WebSocket connection
 */
function handleConnect() {
  updateConnectionStatus(true);
  addLog('success', 'Connected to server! Ready to receive jobs.');
}

/**
 * Handle WebSocket disconnection
 */
function handleDisconnect() {
  updateConnectionStatus(false);
  addLog('warning', 'Disconnected from server.');
}

/**
 * Handle WebSocket error
 */
function handleError(error) {
  addLog('error', `Connection error: ${error.message}`);
}


/****************************************************************/
/*                    MESSAGE HANDLING                          */
/****************************************************************/

/**
 * Handle incoming WebSocket messages
 */
function handleMessage(message) {
  switch (message.type) {
    case 'connected':
      addLog('info', 'Server acknowledged connection');
      break;

    case 'new_job':
      handleNewJob(message);
      break;

    case 'job_completed':
      addLog('success', `Job ${message.jobId} completed successfully`);
      break;

    case 'job_failed':
      addLog('error', `Job ${message.jobId} failed: ${message.error}`);
      break;

    default:
      addLog('info', `Received: ${message.type}`);
  }
}

/**
 * Handle new job message
 */
async function handleNewJob(message) {
  jobsReceived++;
  updateStats();

  const job = message.job;
  addLog('info', `New job received: ${job.category}/${job.subcategory}`);
  addLog('info', `Job ID: ${job.id}`);
  addLog('info', `Layout: ${job.layout}`);
  addLog('info', `Mockup: ${job.mockupPath}`);

  let result = null;
  try {
    // Process the mockup
    result = await processMockup(job);
    console.log('[Job] Process complete, file data size:', result.fileData.byteLength);

    // Upload file to server via HTTP
    addLog('info', 'Uploading to server...');
    console.log('[Job] Starting file upload...');

    // Create FormData with the binary data
    const formData = new FormData();
    const blob = new Blob([result.fileData], { type: 'image/jpeg' });
    const fileName = `processed_${job.id}.jpg`;
    formData.append('mockup', blob, fileName);

    console.log('[Job] FormData created, uploading...');

    // Upload to server
    const uploadResponse = await fetch('http://localhost:3001/upload-mockup', {
      method: 'POST',
      body: formData
    });

    if (!uploadResponse.ok) {
      throw new Error(`Upload failed: ${uploadResponse.statusText}`);
    }

    const uploadResult = await uploadResponse.json();
    console.log('[Job] Upload complete:', uploadResult.filePath);
    addLog('success', 'Upload complete');

    // Send success response with file URL
    addLog('info', 'Sending result to extension...');
    if (wsClient && wsClient.isConnected()) {
      console.log('[Job] Sending WebSocket message...');
      wsClient.send({
        type: 'job_completed',
        jobId: job.id,
        resultPath: uploadResult.filePath,
      });
      console.log('[Job] WebSocket message sent');
      jobsCompleted++;
      updateStats();
      addLog('success', `Job ${job.id} completed successfully`);
    } else {
      console.error('[Job] WebSocket not connected');
      addLog('error', 'WebSocket not connected');
    }
  } catch (error) {
    console.error('[Job] Error occurred:', error);
    console.error('[Job] Error stack:', error.stack);

    // Note: Temp files in Adobe's temporary folder are auto-cleaned by the system
    // No manual cleanup needed (files are locked anyway)

    // Send failure response
    if (wsClient && wsClient.isConnected()) {
      wsClient.send({
        type: 'job_failed',
        jobId: job.id,
        error: error.message,
      });
    }
    addLog('error', `Job ${job.id} failed: ${error.message}`);
  }
}


/****************************************************************/
/*                    PHOTOSHOP AUTOMATION                      */
/****************************************************************/

/**
 * Process mockup in Photoshop
 * Returns the output file path
 */
async function processMockup(job) {
  const photoshop = require('photoshop');
  const app = photoshop.app;
  const fs = require('uxp').storage.localFileSystem;
  let mockupDoc = null;

  try {
    addLog('info', 'Opening mockup PSD file...');
    console.log('[Mockup] Mockup path:', job.mockupPath);

    // Convert Windows path to file:// URL
    let fileUrl = job.mockupPath;
    if (!fileUrl.startsWith('file://')) {
      // Convert backslashes to forward slashes and encode
      fileUrl = 'file:///' + job.mockupPath.replace(/\\/g, '/');
    }
    console.log('[Mockup] File URL:', fileUrl);

    // Open mockup PSD using getEntryWithUrl
    const mockupFile = await fs.getEntryWithUrl(fileUrl);

    if (!mockupFile) {
      throw new Error(`Mockup file not found: ${job.mockupPath}`);
    }

    console.log('[Mockup] Mockup file object:', mockupFile);

    // Download image from URL (before modal scope)
    addLog('info', 'Downloading image from URL...');
    const imageFile = await downloadImage(job.imageUrl, job.id);
    addLog('success', 'Image downloaded');

    // Execute all Photoshop operations in ONE modal scope (like reference plugin)
    const result = await photoshop.core.executeAsModal(async () => {
      // Open document
      mockupDoc = await app.open(mockupFile);
      console.log('[Mockup] Document opened:', mockupDoc.name);
      addLog('success', 'Mockup opened successfully');

      // Find smart object layer
      addLog('info', 'Verifying smart object layer "Artwork"...');
      const smartLayerResult = findSmartObjectLayer(mockupDoc);

      if (!smartLayerResult) {
        // List all smart objects found to help debugging
        const allSmartObjects = findAllSmartObjects(mockupDoc);
        const errorMsg = allSmartObjects.length > 0
          ? `Smart object "Artwork" not found. Found ${allSmartObjects.length} smart object(s): ${allSmartObjects.join(', ')}`
          : 'No smart objects found in this mockup. Please add a smart object layer named "Artwork".';
        throw new Error(errorMsg);
      }
      addLog('success', `Found smart object: ${smartLayerResult.path}`);

      // Replace smart object content
      addLog('info', 'Replacing smart object content...');
      const updatedDoc = await replaceSmartObject(smartLayerResult.layer, imageFile, mockupDoc);
      mockupDoc = updatedDoc; // Use the updated document reference
      addLog('success', 'Smart object replaced');

      // Flatten and export
      addLog('info', 'Flattening and exporting...');
      await mockupDoc.flatten();

      // Save as JPEG to temp folder (no dialog)
      addLog('info', 'Saving to temp folder...');
      const tempFolder = await fs.getTemporaryFolder();
      console.log('[Mockup] Temp folder:', tempFolder.nativePath);

      const outputFileName = `processed_${job.id}.jpg`;
      const outputFile = await tempFolder.createFile(outputFileName, { overwrite: true });
      console.log('[Mockup] Output file created:', outputFile.nativePath);

      await mockupDoc.saveAs.jpg(outputFile, { quality: 12 }, true);
      addLog('success', `Mockup exported: ${outputFileName}`);

      // Read file as binary data (inside modal scope for best compatibility)
      addLog('info', 'Reading file data...');
      const formats = require('uxp').storage.formats;
      const fileData = await outputFile.read({ format: formats.binary });
      console.log('[Mockup] File data read, size:', fileData.byteLength, 'bytes');

      // Close document (don't save PSD changes)
      await mockupDoc.close('no');
      console.log('[Mockup] Document closed');

      // Delete temp image file immediately (not actively locked)
      try {
        await imageFile.delete();
        console.log('[Mockup] Deleted temp image file immediately');
      } catch (err) {
        console.warn('[Mockup] Could not delete temp image immediately:', err.message);
      }

      // Note: We don't delete the temp mockup file because:
      // 1. It's locked from the saveAs.jpg() and read() operations
      // 2. It's in Adobe's temporary folder which is auto-cleaned by the system
      // 3. Manual deletion attempts fail with "resource busy or locked"
      console.log('[Mockup] Temp mockup file will be cleaned by system:', outputFile.nativePath);

      // Return only binary data (no file reference needed)
      return {
        fileData: fileData
      };

    }, {
      commandName: 'Process Mockup',
      interactive: true
    });

    return result;

  } catch (error) {
    // Make sure to close document even if error occurs
    try {
      if (mockupDoc) {
        await photoshop.core.executeAsModal(async () => {
          await mockupDoc.close('no');
        }, { commandName: 'Cleanup' });
      }
    } catch (closeError) {
      addLog('warning', 'Failed to close document after error');
    }
    throw error;
  }
}

/**
 * Download image from URL
 */
async function downloadImage(url, jobId) {
  const fs = require('uxp').storage.localFileSystem;
  const formats = require('uxp').storage.formats;

  console.log('[DownloadImage] Downloading from:', url);

  // Get temporary folder
  const tempFolder = await fs.getTemporaryFolder();
  console.log('[DownloadImage] Temp folder:', tempFolder);

  // Fetch image
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  console.log('[DownloadImage] Image fetched, status:', response.status);

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  console.log('[DownloadImage] Image size:', arrayBuffer.byteLength, 'bytes');

  // Save to temp file
  const tempFileName = `temp_${jobId}.jpg`;
  const tempFile = await tempFolder.createFile(tempFileName, { overwrite: true });
  console.log('[DownloadImage] Temp file created:', tempFile.nativePath);

  await tempFile.write(arrayBuffer, { format: formats.binary });
  console.log('[DownloadImage] Image written to file');

  return tempFile;
}

/**
 * Find all smart object layers in document (for debugging)
 */
function findAllSmartObjects(doc) {
  const smartObjects = [];

  // Search through layers recursively
  function searchLayers(layers, path = '') {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const currentPath = path ? `${path} > ${layer.name}` : layer.name;

      // Check if this is a smart object (using string comparison)
      if (layer.kind === 'smartObject') {
        smartObjects.push(`"${layer.name}" (${currentPath})`);
      }

      // Recursively search layer groups
      if (layer.kind === 'group' && layer.layers && layer.layers.length > 0) {
        searchLayers(layer.layers, currentPath);
      }
    }
  }

  searchLayers(doc.layers);
  return smartObjects;
}

/**
 * Find smart object layer named "Artwork" (case-insensitive) in document
 */
function findSmartObjectLayer(doc) {
  // Search through layers recursively
  function searchLayers(layers, path = '') {
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const currentPath = path ? `${path} > ${layer.name}` : layer.name;

      // Check if this is a smart object named "Artwork" (case-insensitive)
      // Note: layer.kind is a string, not an enum
      if (layer.kind === 'smartObject') {
        if (layer.name.toLowerCase().trim() === 'artwork') {
          return { layer, path: currentPath };
        }
      }

      // Recursively search layer groups
      if (layer.kind === 'group' && layer.layers && layer.layers.length > 0) {
        const found = searchLayers(layer.layers, currentPath);
        if (found) return found;
      }
    }
    return null;
  }

  return searchLayers(doc.layers);
}

/**
 * Replace smart object content (using the working plugin's method)
 * NOTE: This function should be called from within an executeAsModal scope
 */
async function replaceSmartObject(smartLayer, imageFile, mainDoc) {
  const { batchPlay } = require('photoshop').action;
  const { storage } = require('uxp');
  const photoshop = require('photoshop');
  const app = photoshop.app;

  console.log('[ReplaceSmartObject] Replacing smart object with:', imageFile.name);
  addLog('info', `Replacing smart object with: ${imageFile.name}`);

  try {
    // Get file token for the image file
    const token = await storage.localFileSystem.createSessionToken(imageFile);
    console.log('[ReplaceSmartObject] Session token created');

    // Open the smart object for editing
    addLog('info', 'Opening smart object for editing...');
    console.log('[ReplaceSmartObject] Selecting layer ID:', smartLayer.id);

    // Select the smart object layer
    await batchPlay(
      [
        {
          _obj: 'select',
          _target: [{ _ref: 'layer', _id: smartLayer.id }],
        },
      ],
      {}
    );

    // Open the smart object
    await batchPlay(
      [
        {
          _obj: 'placedLayerEditContents',
          _target: [{ _ref: 'layer', _id: smartLayer.id }],
        },
      ],
      {}
    );

    // Wait for smart object to open
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const smartObjectDoc = app.activeDocument;
    console.log('[ReplaceSmartObject] Smart object opened:', smartObjectDoc.name);
    addLog('success', 'Smart object opened');

    // Place the new image
    addLog('info', 'Placing new image...');
    await batchPlay(
      [
        {
          _obj: 'placeEvent',
          null: { _path: token, _kind: 'local' },
          freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
        },
      ],
      {}
    );

    // Get canvas and image dimensions
    const canvas = { width: smartObjectDoc.width, height: smartObjectDoc.height };
    const imageLayer = smartObjectDoc.activeLayers[0];
    const imageBounds = imageLayer.bounds;
    const image = {
      width: imageBounds.right - imageBounds.left,
      height: imageBounds.bottom - imageBounds.top,
    };

    // Calculate scale to cover canvas
    const scaleX = canvas.width / image.width;
    const scaleY = canvas.height / image.height;
    const scale = Math.max(scaleX, scaleY) * 100; // Convert to percentage

    console.log('[ReplaceSmartObject] Scaling image to cover:', scale + '%');

    // Apply transform
    await batchPlay(
      [
        {
          _obj: 'transform',
          _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }],
          freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
          offset: { _obj: 'offset', horizontal: { _unit: 'pixelsUnit', _value: 0 }, vertical: { _unit: 'pixelsUnit', _value: 0 } },
          width: { _unit: 'percentUnit', _value: scale },
          height: { _unit: 'percentUnit', _value: scale },
          interfaceIconFrameDimmed: { _enum: 'interpolationType', _value: 'bicubic' },
        },
      ],
      {}
    );

    // Save the smart object
    addLog('info', 'Saving smart object...');
    await batchPlay([{ _obj: 'save' }], {});

    // Switch back to main document
    addLog('info', 'Switching back to main document...');
    const mainDocInArray = app.documents.find((d) => d.id === mainDoc.id);

    if (mainDocInArray) {
      await batchPlay(
        [
          {
            _obj: 'select',
            _target: [{ _ref: 'document', _id: mainDocInArray.id }],
          },
        ],
        {}
      );
      addLog('success', 'Switched to main document');

      // Update the smart object layer
      addLog('info', 'Updating smart object layer...');
      await batchPlay([{ _obj: 'placedLayerUpdateAllModified' }], {});
      addLog('success', 'Smart object updated');

      // Close the smart object document
      await smartObjectDoc.close('no');
      console.log('[ReplaceSmartObject] Smart object document closed');

      return mainDocInArray;
    }

    return mainDoc;
  } catch (error) {
    console.error('[ReplaceSmartObject] Error:', error);
    addLog('error', `Failed to replace smart object: ${error.message}`);
    throw error;
  }
}


/****************************************************************/
/*                    UI UPDATES                                */
/****************************************************************/

/**
 * Update connection status UI
 */
function updateConnectionStatus(connected) {
  if (connected) {
    statusIndicator.className = 'status-indicator connected';
    statusText.textContent = 'Connected';
    connectBtn.textContent = 'Disconnect';
    connectBtn.className = 'button secondary';
  } else {
    statusIndicator.className = 'status-indicator disconnected';
    statusText.textContent = 'Disconnected';
    connectBtn.textContent = 'Connect to Server';
    connectBtn.className = 'button primary';
  }
}

/**
 * Update statistics display
 */
function updateStats() {
  jobsReceivedEl.textContent = jobsReceived.toString();
  jobsCompletedEl.textContent = jobsCompleted.toString();
}

/**
 * Add log entry to UI
 */
function addLog(level, message) {
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });

  const logEntry = document.createElement('div');
  logEntry.className = 'log-entry';

  logEntry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-level ${level}">${level.toUpperCase()}</span>
    <span class="log-message">${message}</span>
  `;

  logsContainer.appendChild(logEntry);

  // Auto-scroll to bottom
  logsContainer.scrollTop = logsContainer.scrollHeight;

  // Limit log entries to 100
  if (logsContainer.children.length > 100) {
    logsContainer.removeChild(logsContainer.firstChild);
  }
}

/**
 * Clear all logs
 */
function clearLogs() {
  logsContainer.innerHTML = '';
  addLog('info', 'Logs cleared');
}
