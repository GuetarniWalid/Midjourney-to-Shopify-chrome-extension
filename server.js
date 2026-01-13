/****************************************************************/
/*                         CONFIGURATION                        */
/****************************************************************/

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');
const { WebSocketServer } = require('ws');
const http = require('http');
const multer = require('multer');

const PORT = 3001;
const WS_PORT = 8081;
const MOCKUPS_PATH = 'C:\\Users\\gueta\\Documents\\Mes_projets\\MyselfMonArt_Backend\\photoshop-plugin\\mockups';
const UPLOADS_PATH = path.join(__dirname, 'uploads');


/****************************************************************/
/*                      EXPRESS SETUP                           */
/****************************************************************/

const app = express();

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies
app.use(express.json());

// Serve uploaded files statically
app.use('/uploads', express.static(UPLOADS_PATH));

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    // Create uploads directory if it doesn't exist
    try {
      await fs.mkdir(UPLOADS_PATH, { recursive: true });
    } catch (err) {
      // Directory already exists, that's fine
    }
    cb(null, UPLOADS_PATH);
  },
  filename: (req, file, cb) => {
    // Use the original filename from the client
    cb(null, file.originalname);
  }
});

const upload = multer({ storage });


/****************************************************************/
/*                    WEBSOCKET SETUP                           */
/****************************************************************/

// WebSocket server for UXP plugin communication
const wss = new WebSocketServer({ port: WS_PORT });

// Store connected UXP plugin client
let uxpClient = null;

// Store pending jobs and their callbacks
const pendingJobs = new Map();

wss.on('connection', (ws) => {
  console.log('[WebSocket] UXP plugin connected');
  uxpClient = ws;

  // Send connection acknowledgment
  ws.send(JSON.stringify({ type: 'connected' }));

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('[WebSocket] Received from UXP:', message.type);

      // Handle job completion
      if (message.type === 'job_completed') {
        const callback = pendingJobs.get(message.jobId);
        if (callback) {
          callback.resolve({
            success: true,
            jobId: message.jobId,
            resultPath: message.resultPath
          });
          pendingJobs.delete(message.jobId);
        }
      }

      // Handle job failure
      if (message.type === 'job_failed') {
        const callback = pendingJobs.get(message.jobId);
        if (callback) {
          callback.reject(new Error(message.error || 'Job failed'));
          pendingJobs.delete(message.jobId);
        }
      }
    } catch (error) {
      console.error('[WebSocket] Error parsing message:', error);
    }
  });

  ws.on('close', () => {
    console.log('[WebSocket] UXP plugin disconnected');
    uxpClient = null;
  });

  ws.on('error', (error) => {
    console.error('[WebSocket] Error:', error);
  });
});


/****************************************************************/
/*                    FOLDER SCANNING                           */
/****************************************************************/

/**
 * Scan mockups folder and retrieve categories/subcategories
 */
async function scanMockupsFolder(mockupsPath) {
  const categories = [];

  try {
    // Check if folder exists
    await fs.access(mockupsPath);

    // Read all entries in mockups folder
    const entries = await fs.readdir(mockupsPath, { withFileTypes: true });

    // Process each category folder
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const categoryPath = path.join(mockupsPath, entry.name);

        try {
          // Read subcategories
          const subEntries = await fs.readdir(categoryPath, { withFileTypes: true });
          const subcategories = subEntries
            .filter(subEntry => subEntry.isDirectory())
            .map(subEntry => subEntry.name);

          categories.push({
            name: entry.name,
            subcategories: subcategories
          });
        } catch (error) {
          console.error(`Error reading category ${entry.name}:`, error);
          categories.push({
            name: entry.name,
            subcategories: []
          });
        }
      }
    }

    return categories;
  } catch (error) {
    throw new Error(`Cannot access mockups folder: ${error.message}`);
  }
}


/****************************************************************/
/*                        API ROUTES                            */
/****************************************************************/

/**
 * GET /categories
 * Returns the list of categories and subcategories
 */
app.get('/categories', async (req, res) => {
  try {
    const categories = await scanMockupsFolder(MOCKUPS_PATH);
    res.json({
      success: true,
      categories: categories
    });
  } catch (error) {
    console.error('Error scanning mockups folder:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'MyselfMonArt Publisher bridge server is running',
    mockupsPath: MOCKUPS_PATH,
    timestamp: new Date().toISOString()
  });
});

/**
 * POST /upload-mockup
 * Upload a generated mockup file from the UXP plugin
 */
app.post('/upload-mockup', upload.single('mockup'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded'
      });
    }

    const fileUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;

    console.log('[Upload] Mockup uploaded:', req.file.filename);

    res.json({
      success: true,
      fileName: req.file.filename,
      filePath: fileUrl,
      size: req.file.size
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * DELETE /delete-mockup/:filename
 * Delete a generated mockup file from the uploads folder
 */
app.delete('/delete-mockup/:filename', async (req, res) => {
  try {
    const filename = req.params.filename;
    const filePath = path.join(UPLOADS_PATH, filename);

    // Check if file exists
    try {
      await fs.access(filePath);
    } catch {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      });
    }

    // Delete the file
    await fs.unlink(filePath);
    console.log('[Delete] Mockup deleted:', filename);

    res.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('[Delete] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /submit-job
 * Submit a mockup job to the UXP plugin
 */
app.post('/submit-job', async (req, res) => {
  try {
    const { imageUrl, category, subcategory, layout } = req.body;

    // Validate input
    if (!imageUrl || !category || !subcategory || !layout) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: imageUrl, category, subcategory, layout'
      });
    }

    // Check if UXP plugin is connected
    if (!uxpClient || uxpClient.readyState !== 1) {
      return res.status(503).json({
        success: false,
        error: 'UXP plugin is not connected. Please open the plugin in Photoshop.'
      });
    }

    // Generate job ID
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(7)}`;

    // Create job promise
    const jobPromise = new Promise((resolve, reject) => {
      // Store callback for when job completes
      pendingJobs.set(jobId, { resolve, reject });

      // Set timeout (2 minutes)
      setTimeout(() => {
        if (pendingJobs.has(jobId)) {
          pendingJobs.delete(jobId);
          reject(new Error('Job timeout'));
        }
      }, 120000);
    });

    // Construct mockup PSD path
    const mockupPath = path.join(MOCKUPS_PATH, category, subcategory, `${layout}.psd`);

    // Send job to UXP plugin
    const job = {
      type: 'new_job',
      job: {
        id: jobId,
        imageUrl: imageUrl,
        mockupPath: mockupPath,
        category: category,
        subcategory: subcategory,
        layout: layout
      }
    };

    uxpClient.send(JSON.stringify(job));
    console.log('[WebSocket] Sent job to UXP:', jobId);

    // Wait for job completion
    const result = await jobPromise;

    res.json(result);
  } catch (error) {
    console.error('Error submitting job:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /mockup-image/:category/:subcategory/:layout
 * Serves mockup preview images
 * layout can be: portrait, landscape, square
 */
app.get('/mockup-image/:category/:subcategory/:layout', async (req, res) => {
  try {
    const { category, subcategory, layout } = req.params;

    // Decode URI components (Express does this automatically, but being explicit)
    const decodedCategory = decodeURIComponent(category);
    const decodedSubcategory = decodeURIComponent(subcategory);

    // Validate layout
    if (!['portrait', 'landscape', 'square'].includes(layout)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid layout. Must be portrait, landscape, or square'
      });
    }

    // Construct image path
    const imagePath = path.join(MOCKUPS_PATH, decodedCategory, decodedSubcategory, `${layout}.png`);

    // Check if file exists
    await fs.access(imagePath);

    // Send the image file
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Error serving mockup image:', error.message);
    res.status(404).json({
      success: false,
      error: 'Image not found'
    });
  }
});


/****************************************************************/
/*                      SERVER STARTUP                          */
/****************************************************************/

/**
 * Start the Express server
 */
app.listen(PORT, () => {
  console.log('========================================');
  console.log('  MyselfMonArt Publisher Bridge Server');
  console.log('========================================');
  console.log(`HTTP Server running on http://localhost:${PORT}`);
  console.log(`WebSocket Server running on ws://localhost:${WS_PORT}`);
  console.log(`Serving mockups from: ${MOCKUPS_PATH}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/categories`);
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(`  GET  http://localhost:${PORT}/mockup-image/:category/:subcategory/:layout`);
  console.log(`  POST http://localhost:${PORT}/submit-job`);
  console.log('');
  console.log('Press Ctrl+C to stop the server');
  console.log('========================================');
});

/**
 * Handle server errors
 */
app.on('error', (error) => {
  console.error('Server error:', error);
  process.exit(1);
});
