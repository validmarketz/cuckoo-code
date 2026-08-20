# Cuckoo Code

[Download Latest Version](https://github.com/wangyongpeng90/cuckoo-code/releases/latest)

**Cuckoo Code** is a zero Token cost AI Agent desktop application.

It embeds [chat.deepseek.com](https://chat.deepseek.com) into a local Electron window and injects a sidebar overlay. The AI is guided by system prompts to generate tool calls (JavaScript code blocks), which are executed locally in a sandbox after user confirmation, and the results are sent back to the AI. The entire process does not require an API Key and incurs no API call costs—you use the web version account, not the token-billed interface.

---

## Core Capabilities

### Zero Token Cost

No DeepSeek API calls, no API Tokens used. Directly reuses the web chat capabilities, turning the web version of DeepSeek into an Agent capable of executing local operations. No API call fees.

### True AI Agent

Not just chatting. The AI can read/write files, search code, execute commands, query databases, and proceed to the next step based on execution results, forming a "Think -> Act -> Observe -> Act Again" Agent loop.

---

## Main Features

- Desktop Application: Cross-platform Electron native window, experience close to a local tool
- Command Interception: Automatically detects cmd / powershell / bash code blocks, executes after confirmation
- Tool Call System: AI can call tools such as readFile, writeFile, editFile, glob, grep, bash, mysql, deleteFile, etc.
- Project Directory Binding: After initializing a project, the AI gets the directory tree and system prompt, operating based on real project context
- Overlay Panel: Displays command previews, execution results, and history records, toggle with Ctrl+Shift+C or Esc
- Security Mechanisms: 30-second command timeout, 60-second sandbox timeout, 1MB output buffer
- Session Persistence: Login state and settings saved to %APPDATA%/cuckoo-ai-pro-session

---

## Download

Get the latest version installer from Releases:

https://github.com/wangyongpeng90/cuckoo-code/releases/latest

---

## Installation & Running

### Requirements

- Node.js >= 16.0.0
- npm

### Steps

```bash
# Clone repository
git clone https://github.com/wangyongpeng90/cuckoo-code.git
cd cuckoo-code

# Install dependencies
npm install

# Start application
npm start
```

---

## Build & Release

- This repository is configured with GitHub Actions; pushing `v*` tags (e.g., `v0.1.0`) automatically builds Windows and macOS installers and publishes them to Releases
- Local manual build: `npm run build:win` or `npm run build:mac`
- Build outputs go to `dist/` directory

---

## Usage Guide

1. Start the application, it automatically opens the DeepSeek chat page
2. Log in to your DeepSeek web account as usual
3. Click "Initialize Project" to select a project directory; the AI will get the directory tree and system prompt to understand your project
4. Chat with the AI, let it help you modify files, run commands, query code, etc.
5. Commands or tool calls in AI responses are captured by the sidebar
7. After the AI executes tools, results are automatically sent back to the AI, and the AI proceeds to the next step until the task is complete

### Tool Call Examples

When the AI response contains code blocks in the following format, the system executes them in a sandbox and sends the results back to the AI:

````markdown
```cuckoo
const content = await readFile("src/utils/helper.js");
await writeFile("src/utils/helper.js", content.replace("formatDate", "formatTime"));
```
````

The legacy JSON tool call format is still compatible.

---

## Tool System

List of supported tools (defined in tools/ directory):

| JS Function (cuckoo code block) | JSON Tool Name (legacy format) | Description |
|----------|----------|----------|
| writeFile(file_path, content, encoding?) | file_write | Write file, auto-create parent directories |
| readFile(file_path, encoding?) | file_read | Read file content |
| editFile(file_path, old_string, new_string, replace_all?) | file_edit | Precisely find and replace file content |
| glob(pattern, path?) | file_glob | Search files by glob pattern |
| grep(pattern, options?) | file_grep | Search file content by regex or text |
| bash(command, options?) | bash | Execute Shell command |
| mysql(options) | mysql | Execute SQL query, requires connection parameters |
| deleteFile(file_path) | file_delete | Delete file |
| webFetch(url, options?) | web_fetch | Access webpage or API, get text/JSON/response |
| log(...args) | - | Output intermediate results to execution log |

All tool operations are relative to the currently bound project directory for safety.

---

## Project Structure

```
cuckoo-code/
├── main.js               # Electron main process
├── preload.js            # Preload script, injects overlay UI and IPC
├── package.json
├── systemPrompt.md       # System prompt template
├── tools/                # Tool implementations
│   ├── ToolRegistry.js
│   ├── FileWriteTool.js
│   ├── FileReadTool.js
│   ├── JsRunner.js
│   └── rules.md          # Tool call rule documentation
└── .cuckooCode/          # Project config directory, auto-generated
```

---

## Community Group

Join the Cuckoo Code WeChat group to exchange experiences with other users:

![WeChat Group](assets/wechat-group.png)

> The QR code expires in about 7 days. If it has expired, please remind us to update it in Issues.

---

## Contributing

Issues and Pull Requests are welcome.

- Report bugs or suggest new features: Issues
- Submit code: Pull Requests

---

## License

This project uses the GNU General Public License v3.0 license. See LICENSE file for details.

---

## Acknowledgments

- DeepSeek for providing powerful AI capabilities
- Electron for cross-platform desktop framework
- All contributors and users
