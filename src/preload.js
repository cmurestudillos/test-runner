const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Funciones para interactuar con el sistema de archivos
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  readDirectory: path => ipcRenderer.invoke('read-directory', path),

  // Funciones para ejecutar tests
  runTest: (testPath, projectPath) => ipcRenderer.invoke('run-test', testPath, projectPath),

  // Funciones para watch mode
  watchProject: projectPath => ipcRenderer.invoke('watch-project', projectPath),
  stopWatch: projectPath => ipcRenderer.invoke('stop-watch', projectPath),

  // Listeners para eventos del proceso principal
  onTestOutput: callback => {
    ipcRenderer.on('test-output', (event, data) => callback(data));
  },

  onTestComplete: callback => {
    ipcRenderer.on('test-complete', (event, data) => callback(data));
  },

  onTestFileChanged: callback => {
    ipcRenderer.on('test-file-changed', (event, filePath) => callback(filePath));
  },

  // Limpiar listeners
  removeAllListeners: channel => {
    ipcRenderer.removeAllListeners(channel);
  },
});
