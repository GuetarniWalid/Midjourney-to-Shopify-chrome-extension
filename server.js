/****************************************************************/
/*                         CONFIGURATION                        */
/****************************************************************/

const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const PORT = 3001;
const MOCKUPS_PATH = 'C:\\Users\\gueta\\Documents\\Mes_projets\\MyselfMonArt_Backend\\photoshop-plugin\\mockups';


/****************************************************************/
/*                      EXPRESS SETUP                           */
/****************************************************************/

const app = express();

// Enable CORS for all origins
app.use(cors());

// Parse JSON bodies
app.use(express.json());


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
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Serving mockups from: ${MOCKUPS_PATH}`);
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET http://localhost:${PORT}/categories`);
  console.log(`  GET http://localhost:${PORT}/health`);
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
