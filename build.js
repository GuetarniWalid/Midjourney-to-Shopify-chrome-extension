const fs = require('fs');
const path = require('path');

// Determine environment (from command line argument or NODE_ENV)
const env = process.argv[2] || process.env.NODE_ENV || 'development';
const envFile = `.env.${env}`;

console.log(`\n🔨 Building MyselfMonArt Publisher for ${env} environment...\n`);

// Read environment variables
if (!fs.existsSync(envFile)) {
  console.error(`❌ Error: ${envFile} not found`);
  process.exit(1);
}

const envContent = fs.readFileSync(envFile, 'utf-8');
const envVars = {};

envContent.split('\n').forEach(line => {
  const [key, value] = line.split('=');
  if (key && value) {
    envVars[key.trim()] = value.trim();
  }
});

console.log('📝 Environment variables loaded:');
console.log(`   API_URL: ${envVars.API_URL}`);
console.log(`   MOCKUP_SERVER_URL: ${envVars.MOCKUP_SERVER_URL}`);
console.log(`   WEBSOCKET_URL: ${envVars.WEBSOCKET_URL}\n`);

// Create root dist directory
const rootDistDir = path.join(__dirname, 'dist');
if (fs.existsSync(rootDistDir)) {
  fs.rmSync(rootDistDir, { recursive: true, force: true });
}
fs.mkdirSync(rootDistDir);

/****************************************************************/
/*                   BUILD CHROME EXTENSION                     */
/****************************************************************/

console.log('🔵 Building Chrome Extension...');

const extensionSrcDir = path.join(__dirname, 'chrome-extension');
const extensionDistDir = path.join(rootDistDir, 'chrome-extension');
fs.mkdirSync(extensionDistDir);

// Files to process (replace CONFIG)
const extensionJsFiles = ['publish.js', 'background.js'];

// Files to copy as-is
const extensionFilesToCopy = ['manifest.json', 'publish.html', 'content.js'];

// Copy files without processing
extensionFilesToCopy.forEach(file => {
  const srcPath = path.join(extensionSrcDir, file);
  const destPath = path.join(extensionDistDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`   ✓ Copied: ${file}`);
  } else {
    console.warn(`   ⚠ Warning: ${file} not found`);
  }
});

// Copy images folder
const extensionImagesDir = path.join(extensionSrcDir, 'images');
const extensionDistImagesDir = path.join(extensionDistDir, 'images');
if (fs.existsSync(extensionImagesDir)) {
  fs.mkdirSync(extensionDistImagesDir);
  const imageFiles = fs.readdirSync(extensionImagesDir);
  imageFiles.forEach(file => {
    fs.copyFileSync(
      path.join(extensionImagesDir, file),
      path.join(extensionDistImagesDir, file)
    );
  });
  console.log(`   ✓ Copied images folder (${imageFiles.length} files)`);
}

// Process JS files and replace CONFIG
extensionJsFiles.forEach(file => {
  const srcPath = path.join(extensionSrcDir, file);
  const destPath = path.join(extensionDistDir, file);

  if (!fs.existsSync(srcPath)) {
    console.warn(`   ⚠ Warning: ${file} not found`);
    return;
  }

  let content = fs.readFileSync(srcPath, 'utf-8');

  // Replace CONFIG object
  const configRegex = /const CONFIG = \{[\s\S]*?\};/;
  const newConfig = `const CONFIG = {
  API_URL: '${envVars.API_URL}',
  MOCKUP_SERVER_URL: '${envVars.MOCKUP_SERVER_URL}'
};`;

  content = content.replace(configRegex, newConfig);

  fs.writeFileSync(destPath, content);
  console.log(`   ✓ Processed: ${file}`);
});

console.log('   ✅ Chrome Extension built\n');

/****************************************************************/
/*                   BUILD PHOTOSHOP UXP PLUGIN                 */
/****************************************************************/

console.log('🟣 Building Photoshop UXP Plugin...');

const uxpSrcDir = path.join(__dirname, 'photoshop-uxp-plugin');
const uxpDistDir = path.join(rootDistDir, 'photoshop-uxp-plugin');
fs.mkdirSync(uxpDistDir);

// Files to process (replace URLs)
const uxpJsFiles = ['app.js'];

// Files to copy as-is
const uxpFilesToCopy = ['manifest.json', 'index.html', 'websocket-client.js', 'README.md', '.gitignore'];

// Copy files without processing
uxpFilesToCopy.forEach(file => {
  const srcPath = path.join(uxpSrcDir, file);
  const destPath = path.join(uxpDistDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`   ✓ Copied: ${file}`);
  } else {
    console.warn(`   ⚠ Warning: ${file} not found`);
  }
});

// Copy icons folder
const uxpIconsDir = path.join(uxpSrcDir, 'icons');
const uxpDistIconsDir = path.join(uxpDistDir, 'icons');
if (fs.existsSync(uxpIconsDir)) {
  fs.mkdirSync(uxpDistIconsDir);
  const iconFiles = fs.readdirSync(uxpIconsDir);
  iconFiles.forEach(file => {
    fs.copyFileSync(
      path.join(uxpIconsDir, file),
      path.join(uxpDistIconsDir, file)
    );
  });
  console.log(`   ✓ Copied icons folder (${iconFiles.length} files)`);
}

// Process JS files and replace hardcoded URLs
uxpJsFiles.forEach(file => {
  const srcPath = path.join(uxpSrcDir, file);
  const destPath = path.join(uxpDistDir, file);

  if (!fs.existsSync(srcPath)) {
    console.warn(`   ⚠ Warning: ${file} not found`);
    return;
  }

  let content = fs.readFileSync(srcPath, 'utf-8');

  // Replace hardcoded WebSocket URL
  content = content.replace(
    /url:\s*['"]ws:\/\/localhost:8081['"]/g,
    `url: '${envVars.WEBSOCKET_URL}'`
  );

  // Replace hardcoded upload URL
  content = content.replace(
    /['"]http:\/\/localhost:3001\/upload-mockup['"]/g,
    `'${envVars.MOCKUP_SERVER_URL}/upload-mockup'`
  );

  fs.writeFileSync(destPath, content);
  console.log(`   ✓ Processed: ${file}`);
});

console.log('   ✅ Photoshop UXP Plugin built\n');

/****************************************************************/
/*                     COPY MOCKUP SERVER                       */
/****************************************************************/

console.log('🟢 Copying Mockup Server...');

const serverSrcDir = path.join(__dirname, 'mockup-server');
const serverDistDir = path.join(rootDistDir, 'mockup-server');
fs.mkdirSync(serverDistDir);

// Copy server files
const serverFiles = ['server.js', 'package.json', 'package-lock.json'];

serverFiles.forEach(file => {
  const srcPath = path.join(serverSrcDir, file);
  const destPath = path.join(serverDistDir, file);

  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`   ✓ Copied: ${file}`);
  } else {
    console.warn(`   ⚠ Warning: ${file} not found`);
  }
});

// Copy node_modules if it exists
const serverNodeModules = path.join(serverSrcDir, 'node_modules');
if (fs.existsSync(serverNodeModules)) {
  console.log('   📦 Copying node_modules (this may take a moment)...');
  copyFolderRecursive(serverNodeModules, path.join(serverDistDir, 'node_modules'));
  console.log('   ✓ Copied node_modules');
} else {
  console.log('   ℹ️  node_modules not found (run npm install in mockup-server)');
}

// Create uploads folder
const serverUploadsDir = path.join(serverDistDir, 'uploads');
if (!fs.existsSync(serverUploadsDir)) {
  fs.mkdirSync(serverUploadsDir);
  console.log('   ✓ Created uploads folder');
}

console.log('   ✅ Mockup Server copied\n');

/****************************************************************/
/*                          SUMMARY                             */
/****************************************************************/

console.log('═══════════════════════════════════════════════════════');
console.log('✅ BUILD COMPLETE!');
console.log('═══════════════════════════════════════════════════════');
console.log(`📁 Output: ./dist/ folder\n`);
console.log(`🌍 Environment: ${env}`);
console.log(`   API_URL: ${envVars.API_URL}`);
console.log(`   MOCKUP_SERVER_URL: ${envVars.MOCKUP_SERVER_URL}`);
console.log(`   WEBSOCKET_URL: ${envVars.WEBSOCKET_URL}\n`);
console.log('📦 Components built:');
console.log('   ✓ dist/chrome-extension/     - Load this in Chrome');
console.log('   ✓ dist/photoshop-uxp-plugin/ - Load this in UXP Dev Tool');
console.log('   ✓ dist/mockup-server/        - Run: cd dist/mockup-server && npm start');
console.log('\n💡 Next steps:');
console.log('   1. Load dist/chrome-extension/ in Chrome (chrome://extensions)');
console.log('   2. Load dist/photoshop-uxp-plugin/ in Adobe UXP Developer Tool');
console.log('   3. Start server: cd dist/mockup-server && npm start');
console.log('═══════════════════════════════════════════════════════\n');

/****************************************************************/
/*                      HELPER FUNCTIONS                        */
/****************************************************************/

function copyFolderRecursive(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyFolderRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}
