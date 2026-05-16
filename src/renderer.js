// Estado de la aplicación
const appState = {
  currentProject: null,
  testFiles: [],
  selectedTest: null,
  watchMode: false,
  runningTests: new Set(),
  testResults: new Map(),
  consoleLines: [],
};

// Elementos del DOM
const elements = {
  selectProjectBtn: document.getElementById('selectProjectBtn'),
  watchToggleBtn: document.getElementById('watchToggleBtn'),
  projectPath: document.getElementById('projectPath'),
  testTree: document.getElementById('testTree'),
  noResults: document.getElementById('noResults'),
  testResults: document.getElementById('testResults'),
  consoleOutput: document.getElementById('consoleOutput'),
  clearConsoleBtn: document.getElementById('clearConsoleBtn'),
  statusText: document.getElementById('statusText'),
  watchStatus: document.getElementById('watchStatus'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  passedCount: document.getElementById('passedCount'),
  failedCount: document.getElementById('failedCount'),
  runningCount: document.getElementById('runningCount'),
  showUnit: document.getElementById('showUnit'),
  showE2E: document.getElementById('showE2E'),
  showIntegration: document.getElementById('showIntegration'),
};

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
  setupEventListeners();
  setupElectronListeners();
});

function initializeApp() {
  updateStatus('Listo para usar');
  logToConsole('info', 'Test Runner iniciado correctamente');
}

function setupEventListeners() {
  // Seleccionar proyecto
  elements.selectProjectBtn.addEventListener('click', selectProject);

  // Toggle watch mode
  elements.watchToggleBtn.addEventListener('click', toggleWatchMode);

  // Limpiar consola
  elements.clearConsoleBtn.addEventListener('click', clearConsole);

  // Filtros de tests
  elements.showUnit.addEventListener('change', filterTests);
  elements.showE2E.addEventListener('change', filterTests);
  elements.showIntegration.addEventListener('change', filterTests);
}

function setupElectronListeners() {
  // Escuchar salida de tests
  window.electronAPI.onTestOutput(data => {
    handleTestOutput(data);
  });

  // Escuchar completación de tests
  window.electronAPI.onTestComplete(data => {
    handleTestComplete(data);
  });

  // Escuchar cambios en archivos
  window.electronAPI.onTestFileChanged(filePath => {
    handleFileChanged(filePath);
  });
}

// Funciones principales
async function selectProject() {
  try {
    showLoading(true);
    updateStatus('Seleccionando proyecto...');

    const projectPath = await window.electronAPI.selectDirectory();
    if (!projectPath) {
      updateStatus('Selección cancelada');
      return;
    }

    appState.currentProject = projectPath;
    elements.projectPath.textContent = projectPath;
    elements.watchToggleBtn.disabled = false;

    // Cargar archivos de test
    await loadTestFiles();

    updateStatus('Proyecto cargado correctamente');
    logToConsole('success', `Proyecto cargado: ${projectPath}`);
  } catch (error) {
    logToConsole('error', `Error al cargar proyecto: ${error.message}`);
    updateStatus('Error al cargar proyecto');
  } finally {
    showLoading(false);
  }
}

async function loadTestFiles() {
  try {
    updateStatus('Explorando archivos de test...');

    const files = await window.electronAPI.readDirectory(appState.currentProject);
    appState.testFiles = files;

    renderTestTree();
    updateTestStats();

    logToConsole('info', `Se encontraron ${countTestFiles(files)} archivos de test`);
  } catch (error) {
    logToConsole('error', `Error al cargar archivos: ${error.message}`);
    throw error;
  }
}

function countTestFiles(files) {
  let count = 0;

  function countRecursive(items) {
    for (const item of items) {
      if (item.type === 'file') {
        count++;
      } else if (item.type === 'directory' && item.children) {
        countRecursive(item.children);
      }
    }
  }

  countRecursive(files);
  return count;
}

function renderTestTree() {
  elements.testTree.innerHTML = '';

  if (appState.testFiles.length === 0) {
    elements.testTree.innerHTML = '<div class="no-results">No se encontraron archivos de test</div>';
    return;
  }

  renderTestItems(appState.testFiles, elements.testTree);
}

function renderTestItems(items, container, level = 0) {
  for (const item of items) {
    if (!shouldShowTest(item)) {
      continue;
    }

    const itemElement = document.createElement('div');
    itemElement.className = `test-item ${item.type}`;
    itemElement.style.paddingLeft = `${level * 16 + 8}px`;

    if (item.type === 'directory') {
      itemElement.innerHTML = `
                📁 ${item.name}
                <span class="test-count">(${countTestFiles([item])})</span>
            `;

      if (item.children) {
        renderTestItems(item.children, container, level + 1);
      }
    } else {
      const statusIndicator = getTestStatusIndicator(item.path);
      const testType = item.testType || 'unit';

      itemElement.innerHTML = `
                🧪 ${item.name}
                <span class="test-type ${testType}">${testType.toUpperCase()}</span>
                ${statusIndicator}
            `;

      itemElement.addEventListener('click', () => selectTest(item, itemElement));
      itemElement.addEventListener('dblclick', () => runSingleTest(item));
    }

    container.appendChild(itemElement);
  }
}

function shouldShowTest(item) {
  if (item.type === 'directory') {
    return true;
  }

  const testType = item.testType || 'unit';

  switch (testType) {
    case 'unit':
      return elements.showUnit.checked;
    case 'e2e':
      return elements.showE2E.checked;
    case 'integration':
      return elements.showIntegration.checked;
    default:
      return true;
  }
}

function getTestStatusIndicator(testPath) {
  if (appState.runningTests.has(testPath)) {
    return '<div class="status-indicator running"></div>';
  }

  const result = appState.testResults.get(testPath);
  if (result) {
    const status = result.success ? 'passed' : 'failed';
    return `<div class="status-indicator ${status}"></div>`;
  }

  return '<div class="status-indicator"></div>';
}

function selectTest(testItem, element) {
  document.querySelectorAll('.test-item.selected').forEach(el => {
    el.classList.remove('selected');
  });

  element.classList.add('selected');
  appState.selectedTest = testItem;

  // Mostrar resultados si existen
  displayTestResults(testItem.path);

  updateStatus(`Seleccionado: ${testItem.name}`);
}

async function runSingleTest(testItem) {
  if (!appState.currentProject) {
    logToConsole('error', 'No hay proyecto seleccionado');
    return;
  }

  try {
    appState.runningTests.add(testItem.path);
    updateTestStats();
    renderTestTree(); // Actualizar indicadores visuales

    updateStatus(`Ejecutando: ${testItem.name}`);
    logToConsole('info', `Iniciando test: ${testItem.path}`);

    // Ejecutar el test
    await window.electronAPI.runTest(testItem.path, appState.currentProject);
  } catch (error) {
    logToConsole('error', `Error ejecutando test: ${error.message}`);
    appState.runningTests.delete(testItem.path);
    updateTestStats();
  }
}

function handleTestOutput(data) {
  const { type, data: output, testPath } = data;

  // Agregar a la consola
  const logType = type === 'stderr' ? 'error' : 'info';
  logToConsole(logType, output.trim(), false);

  // Actualizar resultados en tiempo real si es necesario
  if (appState.selectedTest && appState.selectedTest.path === testPath) {
    // Aquí podrías actualizar la vista de resultados en tiempo real
  }
}

function handleTestComplete(data) {
  const { testPath, result } = data;

  // Actualizar estado
  appState.runningTests.delete(testPath);
  appState.testResults.set(testPath, result);

  // Log del resultado
  const status = result.success ? 'success' : 'error';
  const message = result.success ? `✅ Test completado: ${testPath}` : `❌ Test falló: ${testPath}`;

  logToConsole(status, message);

  // Actualizar interfaz
  updateTestStats();
  renderTestTree();

  // Mostrar resultados si es el test seleccionado
  if (appState.selectedTest && appState.selectedTest.path === testPath) {
    displayTestResults(testPath);
  }

  updateStatus('Listo');
}

function displayTestResults(testPath) {
  const result = appState.testResults.get(testPath);

  if (!result) {
    elements.noResults.style.display = 'block';
    elements.testResults.style.display = 'none';
    return;
  }

  elements.noResults.style.display = 'none';
  elements.testResults.style.display = 'block';

  const statusClass = result.success ? 'passed' : 'failed';
  const statusIcon = result.success ? '✅' : '❌';
  const statusText = result.success ? 'PASÓ' : 'FALLÓ';

  elements.testResults.innerHTML = `
        <div class="test-result-item">
            <div class="test-result-header ${statusClass}">
                ${statusIcon} Test ${statusText}
                <small>Código de salida: ${result.exitCode}</small>
            </div>
            <div class="test-result-body">
                ${
                  result.output
                    ? `
                    <div class="test-output-section">
                        <h4>Salida estándar:</h4>
                        <div class="test-output-code">${escapeHtml(result.output)}</div>
                    </div>
                `
                    : ''
                }
                ${
                  result.error
                    ? `
                    <div class="test-output-section">
                        <h4>Errores:</h4>
                        <div class="test-output-code error">${escapeHtml(result.error)}</div>
                    </div>
                `
                    : ''
                }
            </div>
        </div>
    `;
}

async function toggleWatchMode() {
  if (!appState.currentProject) {
    return;
  }

  try {
    if (appState.watchMode) {
      // Desactivar watch mode
      await window.electronAPI.stopWatch(appState.currentProject);
      appState.watchMode = false;
      elements.watchToggleBtn.textContent = '👁️ Activar Watch Mode';
      elements.watchStatus.textContent = 'Watch: Inactivo';
      logToConsole('info', 'Watch mode desactivado');
    } else {
      // Activar watch mode
      await window.electronAPI.watchProject(appState.currentProject);
      appState.watchMode = true;
      elements.watchToggleBtn.textContent = '👁️ Desactivar Watch Mode';
      elements.watchStatus.textContent = 'Watch: Activo';
      logToConsole('success', 'Watch mode activado');
    }

    updateStatus(`Watch mode ${appState.watchMode ? 'activado' : 'desactivado'}`);
  } catch (error) {
    logToConsole('error', `Error en watch mode: ${error.message}`);
  }
}

function handleFileChanged(filePath) {
  const fileName = filePath.split(/[/\\]/).pop();
  logToConsole('info', `Archivo modificado: ${fileName}`);
}

function filterTests() {
  renderTestTree();
  updateTestStats();
}

function updateTestStats() {
  let passed = 0;
  let failed = 0;
  let running = appState.runningTests.size;

  appState.testResults.forEach(result => {
    if (result.success) {
      passed++;
    } else {
      failed++;
    }
  });

  elements.passedCount.textContent = `✅ ${passed}`;
  elements.failedCount.textContent = `❌ ${failed}`;
  elements.runningCount.textContent = `⏳ ${running}`;
}

// Utilidades
function updateStatus(message) {
  elements.statusText.textContent = message;
}

function showLoading(show) {
  elements.loadingOverlay.style.display = show ? 'flex' : 'none';
}

function logToConsole(type, message, addTimestamp = true) {
  const timestamp = addTimestamp ? new Date().toLocaleTimeString() : '';
  const line = document.createElement('div');
  line.className = `console-line ${type}`;
  line.innerHTML = `
        <span class="timestamp">[${timestamp || type.toUpperCase()}]</span>
        <span class="message">${escapeHtml(message)}</span>
    `;

  elements.consoleOutput.appendChild(line);
  elements.consoleOutput.scrollTop = elements.consoleOutput.scrollHeight;

  // Limitar líneas de consola
  const lines = elements.consoleOutput.children;
  if (lines.length > 1000) {
    lines[0].remove();
  }
}

function clearConsole() {
  elements.consoleOutput.innerHTML = '';
  logToConsole('info', 'Consola limpiada');
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function handleKeydown(e) {
  const mod = e.ctrlKey || e.metaKey;

  if (mod && e.key === 'o') {
    e.preventDefault();
    selectProject();
  } else if (mod && e.key === 'w') {
    e.preventDefault();
    if (!elements.watchToggleBtn.disabled) {
      toggleWatchMode();
    }
  } else if (mod && e.key === 'l') {
    e.preventDefault();
    clearConsole();
  } else if (e.key === 'Enter' && appState.selectedTest) {
    e.preventDefault();
    runSingleTest(appState.selectedTest);
  }
}

document.addEventListener('keydown', handleKeydown);
