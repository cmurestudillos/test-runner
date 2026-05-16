const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const chokidar = require('chokidar');

let mainWindow;
let watchers = new Map();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    icon: path.join(__dirname, 'assets/icons/icon.png'),
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // Limpiar watchers al cerrar
  watchers.forEach(watcher => watcher.close());
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Seleccionar directorio del proyecto',
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('read-directory', async (event, dirPath) => {
  const files = await fs.readdir(dirPath, { withFileTypes: true });
  const result = [];

  for (const file of files) {
    if (file.isDirectory() && !file.name.startsWith('.') && file.name !== 'node_modules') {
      const subFiles = await getTestFiles(path.join(dirPath, file.name));
      if (subFiles.length > 0) {
        result.push({
          name: file.name,
          type: 'directory',
          path: path.join(dirPath, file.name),
          children: subFiles,
        });
      }
    } else if (file.isFile() && isTestFile(file.name)) {
      result.push({
        name: file.name,
        type: 'file',
        path: path.join(dirPath, file.name),
        testType: getTestType(file.name),
      });
    }
  }

  return result;
});

async function getTestFiles(dirPath) {
  try {
    const files = await fs.readdir(dirPath, { withFileTypes: true });
    const testFiles = [];

    for (const file of files) {
      if (file.isFile() && isTestFile(file.name)) {
        testFiles.push({
          name: file.name,
          type: 'file',
          path: path.join(dirPath, file.name),
          testType: getTestType(file.name),
        });
      } else if (file.isDirectory() && !file.name.startsWith('.')) {
        const subFiles = await getTestFiles(path.join(dirPath, file.name));
        if (subFiles.length > 0) {
          testFiles.push({
            name: file.name,
            type: 'directory',
            path: path.join(dirPath, file.name),
            children: subFiles,
          });
        }
      }
    }

    return testFiles;
  } catch {
    return [];
  }
}

function isTestFile(filename) {
  const testPatterns = [
    /\.test\.(js|ts|jsx|tsx)$/,
    /\.spec\.(js|ts|jsx|tsx)$/,
    /\.e2e\.(js|ts)$/,
    /\.integration\.(js|ts)$/,
  ];

  return testPatterns.some(pattern => pattern.test(filename));
}

function getTestType(filename) {
  if (/\.e2e\.|cypress|playwright|webdriver/.test(filename)) {
    return 'e2e';
  }
  if (/\.integration\./.test(filename)) {
    return 'integration';
  }
  return 'unit';
}

function resolveTestArgs(testPath, scripts) {
  if (testPath.includes('.e2e.') || testPath.includes('cypress')) {
    if (scripts['test:e2e']) {
      return ['run', 'test:e2e'];
    }
    if (scripts['cypress']) {
      return ['run', 'cypress', 'run'];
    }
  } else if (scripts['test:unit']) {
    return ['run', 'test:unit'];
  }
  return ['test'];
}

ipcMain.handle('run-test', async (event, testPath, projectPath) => {
  return new Promise(resolve => {
    const packageJsonPath = path.join(projectPath, 'package.json');
    let command = 'npm';
    let args = ['test'];

    try {
      if (fs.existsSync(packageJsonPath)) {
        const packageJson = require(packageJsonPath);
        if (packageJson.scripts) {
          args = resolveTestArgs(testPath, packageJson.scripts);
        }
        args.push(testPath);
      }
    } catch {
      // Usar configuración por defecto si no se puede leer package.json
    }

    const child = spawn(command, args, {
      cwd: projectPath,
      shell: true,
    });

    let output = '';
    let error = '';

    child.stdout.on('data', data => {
      const chunk = data.toString();
      output += chunk;
      mainWindow.webContents.send('test-output', {
        type: 'stdout',
        data: chunk,
        testPath,
      });
    });

    child.stderr.on('data', data => {
      const chunk = data.toString();
      error += chunk;
      mainWindow.webContents.send('test-output', {
        type: 'stderr',
        data: chunk,
        testPath,
      });
    });

    child.on('close', code => {
      const result = {
        success: code === 0,
        output,
        error,
        exitCode: code,
      };

      mainWindow.webContents.send('test-complete', {
        testPath,
        result,
      });

      resolve(result);
    });
  });
});

ipcMain.handle('watch-project', async (event, projectPath) => {
  // Limpiar watcher existente
  if (watchers.has(projectPath)) {
    watchers.get(projectPath).close();
  }

  const watcher = chokidar.watch(projectPath, {
    ignored: /node_modules|\.git/,
    persistent: true,
    ignoreInitial: true,
  });

  watcher.on('change', filePath => {
    if (isTestFile(path.basename(filePath))) {
      mainWindow.webContents.send('test-file-changed', filePath);
    }
  });

  watchers.set(projectPath, watcher);
  return true;
});

ipcMain.handle('stop-watch', async (event, projectPath) => {
  if (watchers.has(projectPath)) {
    watchers.get(projectPath).close();
    watchers.delete(projectPath);
    return true;
  }
  return false;
});
