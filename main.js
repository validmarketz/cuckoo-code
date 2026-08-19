const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

// ========== Tool库集成 ==========
const { ToolRegistry, Tool, ToolResult } = require('./tools/ToolRegistry');
const { FileWriteTool } = require('./tools/FileWriteTool');
const { FileReadTool } = require('./tools/FileReadTool');
const { FileEditTool } = require('./tools/FileEditTool');
const { GlobTool } = require('./tools/GlobTool');
const { GrepTool } = require('./tools/GrepTool');
const { BashTool } = require('./tools/BashTool');
const { MySQLTool } = require('./tools/MySQLTool');
const { FileDeleteTool } = require('./tools/FileDeleteTool');
const { WebFetchTool } = require('./tools/WebFetchTool');
const { JsRunner } = require('./tools/JsRunner');
const { decodeOutput, normalizeCommand } = require('./tools/decodeOutput');

// CreateTool注册表and注册Tool
const toolRegistry = new ToolRegistry();
toolRegistry.register(new FileWriteTool());
toolRegistry.register(new FileReadTool());
toolRegistry.register(new FileEditTool());
toolRegistry.register(new GlobTool());
toolRegistry.register(new GrepTool());
toolRegistry.register(new BashTool());
toolRegistry.register(new MySQLTool());
toolRegistry.register(new FileDeleteTool());
toolRegistry.register(new WebFetchTool());
// follow-up可在this注册moreTool

// JS Toolscriptexecute器（AI generate JS 代码callToolfunction）
const jsRunner = new JsRunner(toolRegistry);

let mainWindow = null;
let sidebarWindow = null;

// systemPrompt.md path
const SYSTEM_PROMPT_PATH = path.join(__dirname, 'systemPrompt.md');

// ========== session-directory映射持久化存储 ==========
const STORE_FILE = path.join(app.getPath('userData'), 'session-dir-map.json');

/**
 * Reading存储ofsession-directory映射
 */
function readSessionStore() {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const data = fs.readFileSync(STORE_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('[Cuckoo Code] Readingsession存储Failed:', err.message);
  }
  return {};
}

/**
 * 写入session-directory映射
 */
function writeSessionStore(store) {
  try {
    fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    console.log('[Cuckoo Code] session存储已保存');
  } catch (err) {
    console.error('[Cuckoo Code] 写入session存储Failed:', err.message);
  }
}

/**
 * according tosessionIDgetprojectdirectory
 */
function getProjectDirBySessionId(sessionId) {
  if (!sessionId) return null;
  const store = readSessionStore();
  return store[sessionId] || null;
}

/**
 * 保存sessionID与projectdirectoryof映射
 */
function saveSessionDirMapping(sessionId, projectDir) {
  if (!sessionId) return;
  const store = readSessionStore();
  store[sessionId] = projectDir;
  writeSessionStore(store);
}

/**
 * fromURLextract fromsessionID
 * example: https://chat.deepseek.com/a/chat/s/bd9953b8-ff70-4207-9a12-5967be02a066
 * return bd9953b8-ff70-4207-9a12-5967be02a066
 */
function extractSessionIdFromUrl(url) {
  if (!url) return null;
  // 匹配 /chat/s/ 后面of UUID（更鲁棒，support任意prefix）
  const match = url.match(/\/chat\/s\/([a-f0-9-]+)/i);
  if (match) return match[1];
  // 备选：匹配 /s/ 后面of UUID（有些situation下pathpossiblenot同）
  const altMatch = url.match(/\/s\/([a-f0-9-]+)/i);
  return altMatch ? altMatch[1] : null;
}

// currentsessionID（frompageURLextract from）
let currentSessionId = null;
// current选inofprojectdirectory（internal存cache）
let selectedProjectDir = null;
// 待绑定ofprojectdirectory（当initializewhen还notgettosessionIdwhen暂存）
let pendingProjectDir = null;

/**
 * 处理URL变化：extractsessionID，and尝试恢复projectdirectory
 */
function handleUrlChange(url) {
  const sessionId = extractSessionIdFromUrl(url);
  if (sessionId) {
    currentSessionId = sessionId;
    console.log(`[Cuckoo Code] currentsessionID: ${sessionId}`);

    // checkwhether有暂存ofprojectdirectoryneed绑定tocurrentsession
    if (pendingProjectDir) {
      console.log(`[Cuckoo Code] find暂存projectdirectory ${pendingProjectDir}，立即绑定tosession ${sessionId}`);
      saveSessionDirMapping(sessionId, pendingProjectDir);
      selectedProjectDir = pendingProjectDir;
      pendingProjectDir = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('project-dir-updated', selectedProjectDir);
        mainWindow.webContents.send('session-restored', { sessionId, projectDir: selectedProjectDir });
      }
      console.log(`[Cuckoo Code] 暂存directory已绑定tosession ${sessionId}`);
      return;
    }

    // 尝试from存储in恢复projectdirectory
    const restoredDir = getProjectDirBySessionId(sessionId);
    if (restoredDir) {
      selectedProjectDir = restoredDir;
      console.log(`[Cuckoo Code] 已恢复projectdirectory: ${restoredDir}`);
      // 通知renderer process恢复success
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('session-restored', { sessionId, projectDir: restoredDir });
        // senddirectory更新事件，更新UIshow
        mainWindow.webContents.send('project-dir-updated', restoredDir);
      }
    } else {
      console.log(`[Cuckoo Code] session ${sessionId} not foundassociated withofprojectdirectory`);
      // 清emptycurrentdirectory
      selectedProjectDir = null;
      if (mainWindow && !mainWindow.isDestroyed()) {
        // sendemptydirectory事件，更新UIshowas“notselect”
        mainWindow.webContents.send('project-dir-updated', null);
      }
    }
  } else {
    // 非sessionpage（如首页），清empty状态
    currentSessionId = null;
    selectedProjectDir = null;
    console.log('[Cuckoo Code] notdetectedsessionID，已清emptyprojectdirectory');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('project-dir-updated', null);
    }
  }
}

/**
 * 尝试fromcurrentURL恢复sessionandprojectdirectory（在page加载complete后call）
 */
function tryRestoreSessionFromUrl() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const url = mainWindow.webContents.getURL();
  console.log('[Cuckoo Code] 尝试恢复session，currentURL:', url);
  handleUrlChange(url);
}


// ========== 持久化session配置 ==========

// 固定 userData path，ensure session 数据（cookies/localStorage 等）持久保存
const SESSION_DIR = 'cuckoo-ai-pro-session';
app.setPath('userData', path.join(app.getPath('appData'), SESSION_DIR));

console.log('[Cuckoo Code] Session 数据directory:', app.getPath('userData'));

/**
 * 递归getdirectory tree结构string
 * @param {string} dir directorypath
 * @param {number} depth current深度
 * @returns {string} directory treestring
 */
// needignoreofdirectory（依赖、构建产物、版this控制等）
const IGNORED_DIRS = new Set([
  'node_modules', 'target', 'build', 'dist', 'out',
  '.git', '.svn', '.hg',
  '__pycache__', '.pytest_cache', '.coverage',
  'vendor', 'bower_components', 'jspm_packages',
  '.idea', '.vscode', '.vs',
  'logs', 'tmp', 'temp',
  'bin', 'obj',
]);

/**
 * 递归getdirectory tree结构string（类似 Windows tree command风格）
 * @param {string} dir directorypath
 * @param {string} prefix current行prefix（for绘制tree形结构）
 * @returns {string} directory treestring
 */
function getDirectoryTree(dir, prefix = '') {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    // 过滤：skiphidefileandignoreofdirectory
    const visibleEntries = entries
      .filter(e => !e.name.startsWith('.'))
      .filter(e => !e.isDirectory() || !IGNORED_DIRS.has(e.name))
      .sort((a, b) => {
        // directory优先，然后按name排序
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    let tree = '';

    visibleEntries.forEach((entry, index) => {
      const isLast = index === visibleEntries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = prefix + (isLast ? '    ' : '│   ');

      tree += `${prefix}${connector}${entry.name}${entry.isDirectory() ? '/' : ''}\n`;

      if (entry.isDirectory()) {
        tree += getDirectoryTree(path.join(dir, entry.name), childPrefix);
      }
    });

    return tree;
  } catch (err) {
    console.error('[Cuckoo Code] ReadingdirectoryFailed:', err.message);
    return `${prefix}└── [None法Readingdirectory: ${dir}]\n`;
  }
}

/**
 * Initialize project: select directory and send directory tree + systemPrompt
 * 供 IPC call（user点击initializebuttonwhentrigger）
 * @param {boolean} skipPrompt - ifastrue，只更新directory映射，notsendinitialprompt（for修改directory）
 */
function initProject(skipPrompt = false) {
  // 先让userselectdirectory
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openDirectory'],
    buttonLabel: 'selectdirectory',
    title: 'pleaseselect要analyzeofprojectdirectory',
  });

  if (!result || result.length === 0) {
    console.log('[Cuckoo Code] usercancel了directoryselect');
    return { success: false, message: 'usercancel了directoryselect' };
  }

  const selectedDir = result[0];
  console.log('[Cuckoo Code] userselectdirectory:', selectedDir);

  // 保存选inofprojectdirectory
  selectedProjectDir = selectedDir;

  // ========== 持久化存储session-directory映射 ==========
  // ifcurrent有sessionID，保存映射
  if (currentSessionId) {
    saveSessionDirMapping(currentSessionId, selectedDir);
    console.log(`[Cuckoo Code] 已保存session ${currentSessionId} -> ${selectedDir}`);
  } else {
    // ifnot能getsessionID，尝试fromcurrentURLextract
    let sessionId = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      const url = mainWindow.webContents.getURL();
      sessionId = extractSessionIdFromUrl(url);
    }
    if (sessionId) {
      currentSessionId = sessionId;
      saveSessionDirMapping(sessionId, selectedDir);
      console.log(`[Cuckoo Code] fromURLextractsessionIDand保存: ${sessionId} -> ${selectedDir}`);
    } else {
      // None法getsessionID，暂存projectdirectory，等待URL变化后绑定
      pendingProjectDir = selectedDir;
      console.log(`[Cuckoo Code] 暂存projectdirectory ${selectedDir}，等待sessionID出现后绑定`);
    }
  }

  // senddirectory更新事件torenderer process
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('project-dir-updated', selectedDir);
  }

  // if只是修改directory，skipsendinitialprompt
  if (skipPrompt) {
    return { success: true, message: 'projectdirectory已更新' };
  }

  // Initialize Projectwhensendsystem promptandToolrules（withoutdirectory tree）
  // Readingsystem prompt
  let promptContent = '';
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      promptContent = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
    } else {
      console.warn('[Cuckoo Code] systemPrompt.md notexists');
    }
  } catch (err) {
    console.error('[Cuckoo Code] Reading systemPrompt.md Failed:', err.message);
  }

  // ReadingToolusage rules
  let rulesContent = '';
  const RULES_PATH = path.join(__dirname, 'tools', 'rules.md');
  try {
    if (fs.existsSync(RULES_PATH)) {
      rulesContent = fs.readFileSync(RULES_PATH, 'utf-8');
    }
  } catch (err) {
    console.error('[Cuckoo Code] Reading rules.md Failed:', err.message);
  }

  // getTool库描述（JS API format：AI throughgenerate JS 代码call这些function）
  const toolsDescription = toolRegistry.getFormattedJsApiForPrompt();

  // will {TOOLS_LIST} 占位符替换asactualToollist
  const finalRules = rulesContent.replace('{TOOLS_LIST}', toolsDescription);
  const finalPrompt = promptContent.replace('{TOOLS_LIST}', toolsDescription);

  // 组合content（containdirectory tree）
  let projectIntro = '';
  const cuckooMdPath = path.join(selectedDir, '.cuckooCode', 'CUCKOO.md');
  if (fs.existsSync(cuckooMdPath)) {
    try {
      projectIntro = fs.readFileSync(cuckooMdPath, 'utf-8');
      console.log('[Cuckoo Code] 已Reading CUCKOO.md content');
    } catch (err) {
      console.error('[Cuckoo Code] Reading CUCKOO.md Failed:', err.message);
    }
  }

  // getdirectory tree
  // let directoryTree = '';
  // try {
  //   if (fs.existsSync(selectedDir)) {
  //     directoryTree = getDirectoryTree(selectedDir);
  //     console.log('[Cuckoo Code] 已getdirectory tree');
  //   }
  // } catch (err) {
  //   console.error('[Cuckoo Code] getdirectory treeFailed:', err.message);
  // }

  const combined = `
system prompt：
${finalPrompt}
---
Toolusage rules：
${finalRules}
${projectIntro ? `---
## project介绍
${projectIntro}` : ''}
---
## currentprojectdirectory
Current project path: ${selectedDir}
---
If you think you need to use a tool, please directly respond with tool command and parameters, no need to reply with other content`;

  console.log('[Cuckoo Code] Preparing to send initial prompt (without directory tree), length:', combined.length);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('initial-prompt', combined);
  }

  return { success: true, message: 'Initialization complete, system prompt, tool rules and tool library sent' };
}

// 危险commandlist — 匹配toofcommand会额外warning
const DANGEROUS_CMDS = [
  /^rm\s+-rf\s+\//i,
  /^format\s+/i,
  /^del\s+\/f/i,
  /^rd\s+\/s/i,
  /^shutdown\s+/i,
  /^taskkill\s+/i,
  /^diskpart/i,
  /^reg\s+delete/i,
  /^cipher\s+\/w/i,
];

function isDangerous(cmd) {
  return DANGEROUS_CMDS.some((pattern) => pattern.test(cmd.trim()));
}

/**
 * Read systemPrompt.md and send to preload
 */
function sendSystemPrompt() {
  try {
    if (fs.existsSync(SYSTEM_PROMPT_PATH)) {
      const content = fs.readFileSync(SYSTEM_PROMPT_PATH, 'utf-8');
      console.log('[Cuckoo Code] systemPrompt.md 已Reading，length:', content.length, 'bytes');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('system-prompt', content);
      }
    } else {
      console.log('[Cuckoo Code] systemPrompt.md does not exist, skipping');
    }
  } catch (err) {
    console.error('[Cuckoo Code] Reading systemPrompt.md Failed:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    title: 'Cuckoo Code Pro - DeepSeek CMD',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload need访问 Node.js API
      partition: 'persist:cuckoo-deepseek', // 持久化 session（cookies/localStorage）
      backgroundThrottling: false, // 最小化/hidewhennot节流renderer process，avoidToolparsewhen序错乱
    },
  });

  // Check if preload file exists
  const preloadPath = path.join(__dirname, 'preload.js');
  console.log('[Cuckoo Code Main] preload path:', preloadPath);
  console.log('[Cuckoo Code Main] preload exists:', fs.existsSync(preloadPath));

  // Forward renderer process console.log to main process
  mainWindow.webContents.on('console-message', (_event, level, message, _line, _sourceId) => {
    console.log('[Renderer Console]', message);
  });

  // 窗口最大化
  mainWindow.maximize();

  // Set User-Agent to avoid being identified as automation tool
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  mainWindow.webContents.setUserAgent(userAgent);

  // 加载 DeepSeek
  mainWindow.loadURL('https://chat.deepseek.com/');

  // page加载complete后通知renderer process
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('page-loaded');
      // 尝试恢复session-directory映射
      tryRestoreSessionFromUrl();
    }
  });

  // listennavigate事件，detectURL变化（page跳转/新session）
  mainWindow.webContents.on('did-navigate', (_event, url) => {
    console.log('[Cuckoo Code] Page navigation:', url);
    handleUrlChange(url);
  });

  // listenIn-page navigation（SPA路由变化）
  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    console.log('[Cuckoo Code] In-page navigation:', url);
    handleUrlChange(url);
  });

  // Stop listening when webContents is destroyed
  mainWindow.webContents.on('will-destroy', () => {
    // cleanup if needed
  });

  // F12 Open DevTools
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ========== IPC Handlers ==========

// Initialize project: select directory and send directory tree + systemPrompt
ipcMain.handle('init-project', async (_event, { skipPrompt = false } = {}) => {
  return initProject(skipPrompt);
});

// listcurrentprojectdirectoryassociated withofallsessionID
ipcMain.handle('list-sessions', async () => {
  if (!selectedProjectDir) {
    return { success: true, sessions: [] };
  }
  const store = readSessionStore();
  const sessions = Object.keys(store).filter(sessionId => store[sessionId] === selectedProjectDir);
  console.log(`[Cuckoo Code] Listing sessions, project directory ${selectedProjectDir} associated with ${sessions.length} sessions`);
  return { success: true, sessions };
});

// navigateto指定session
ipcMain.handle('navigate-session', async (_event, { sessionId }) => {
  if (!sessionId) {
    return { success: false, error: 'missing sessionID' };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { success: false, error: 'Main window is closed' };
  }
  const url = `https://chat.deepseek.com/a/chat/s/${sessionId}`;
  console.log(`[Cuckoo Code] Navigate to session: ${url}`);
  try {
    await mainWindow.webContents.loadURL(url);
    return { success: true };
  } catch (err) {
    console.error('[Cuckoo Code] Navigation failed:', err.message);
    return { success: false, error: err.message };
  }
});

// executecommand
ipcMain.handle('execute-command', async (_event, { command, id }) => {
  if (!command || typeof command !== 'string') {
    return { id, success: false, error: 'Invalid command' };
  }

  const trimmed = normalizeCommand(command.trim());
  if (!trimmed) {
    return { id, success: false, error: 'Command is empty' };
  }

  // Step 1: Show confirmation dialog
  const dangerWarning = isDangerous(trimmed)
    ? '\n\n⚠️ Warning: This command may be risky, please confirm carefully!'
    : '';

  const result = await dialog.showMessageBox(mainWindow, {
    type: isDangerous(trimmed) ? 'warning' : 'question',
    buttons: ['cancel', 'confirmexecute'],
    defaultId: 0,
    cancelId: 0,
    title: 'Confirm command execution',
    message: 'Will execute the following command:',
    detail: `${trimmed}${dangerWarning}`,
  });

  if (result.response !== 1) {
    return { id, success: false, error: 'User cancelled execution', canceled: true };
  }

  // Step 2: Execute command (encoding: 'buffer' + smart decoding to avoid Chinese GBK garbled text)
  return new Promise((resolve) => {
    const child = exec(
      trimmed,
      {
        cwd: selectedProjectDir || process.env.USERPROFILE || app.getPath('home'),
        timeout: 30000, // 30 秒超when
        maxBuffer: 1024 * 1024, // 1MB Output缓冲
        encoding: 'buffer',
      },
      (error, stdout, stderr) => {
        resolve({
          id,
          success: !error,
          stdout: decodeOutput(stdout),
          stderr: decodeOutput(stderr),
          error: error ? error.message : null,
        });
      }
    );
  });
});

// ========== Toolexecute IPC ==========

/**
 * Execute tool
 * Support AI calling tools from tool library
 */
ipcMain.handle('execute-tool', async (_event, { toolName, params, callId }) => {
  console.log(`[Cuckoo Code] Execute tool: ${toolName}, projectDir=${selectedProjectDir || '(notinitialize,relativepathwillresolve tosystemdirectory)'}`, JSON.stringify(params));
  try {
    // if有选inofprojectdirectory，will其作asworkdirectory传递给Tool
    const paramsWithContext = {
      ...params,
      projectDir: selectedProjectDir
    };
    const result = await toolRegistry.execute(toolName, paramsWithContext);
    if (result.success) {
      console.log(`[Cuckoo Code] ✅ Tool ${toolName} Execution successful:`, JSON.stringify(result.data));
    } else {
      console.log(`[Cuckoo Code] ❌ Tool ${toolName} Execution failed:`, result.error);
    }
    return { callId, success: result.success, data: result.data, error: result.error };
  } catch (err) {
    console.error(`[Cuckoo Code] Tool ${toolName} execution exception:`, err);
    return { callId, success: false, error: err.message };
  }
});

// ========== JS Toolscriptexecute IPC ==========

/**
 * execute AI generated JS Tool代码
 * 代码在受限of vm 沙箱inrun，只能call注入ofToolfunction（readFile/writeFile/editFile/...）
 */
ipcMain.handle('execute-js', async (_event, { code, callId }) => {
  const preview = String(code || '').replace(/\s+/g, ' ').slice(0, 200);
  console.log(`[Cuckoo Code] Execute JS tool script: ${preview}`);
  console.log('[Cuckoo Code] [Diagnosis] main processreceivedof代码(JSONescape): ' + JSON.stringify(String(code || '')).slice(0, 2000));
  if (!code || typeof code !== 'string') {
    return { callId, success: false, error: 'None效of JS 代码' };
  }
  try {
    const result = await jsRunner.run(code, selectedProjectDir);
    if (result.success) {
      console.log('[Cuckoo Code] ✅ JS ToolscriptExecution successful, Outputlength=' + ((result.output || '').length));
    } else {
      console.log('[Cuckoo Code] ❌ JS Tool script execution failed:', result.error);
    }
    return { callId, ...result };
  } catch (err) {
    console.error('[Cuckoo Code] JS Tool script execution exception:', err);
    return { callId, success: false, error: err.message };
  }
});

// ========== Application lifecycle ==========

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
