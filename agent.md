# 🤖 Cuckoo Code - Agent Knowledge Base

> **Purpose**: This document provides AI assistants with complete context about the Cuckoo Code project, enabling them to understand, modify, and extend the codebase effectively.

---

## 🚀 Quick Start for AI Agents

### How to Use This Document

1. **Read this entire document first** to understand the project capabilities
2. **Wait for user commands** via chat interface (e.g., "Add authentication", "Fix bug in X")
3. **Analyze before acting**: Read relevant files using `readFile()`, `glob()`, or `grep()`
4. **Present a plan**: Explain what files you'll modify and what changes you'll make
5. **Wait for confirmation** from the user before making any changes
6. **Execute changes** using precise tool calls (`editFile()`, `writeFile()`, etc.)
7. **Verify and report**: Confirm changes work and summarize what was done

### Key Principle
> **Always read before writing. Never assume. Always confirm before modifying.**

---

## 📋 Project Overview

Cuckoo Code is an AI-powered code assistant that can read, edit, search files, execute commands, and interact with databases and web APIs. It provides a secure sandboxed environment for AI agents to perform coding tasks.


---

## 📁 Project Structure

```
/workspace/
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
├── README.md
├── agent.md
├── assets/
│   ├── wechat-group.png
├── main.js
├── package-lock.json
├── package.json
├── preload.js
├── preload_restored.js
├── scripts/
│   ├── generate-agent-doc.js
│   ├── sync-version.js
├── sheji.md
├── src/
│   ├── utils
├── systemPrompt.md
├── tools/
│   ├── AgentDocGenerator.js
│   ├── BashTool.js
│   ├── FileDeleteTool.js
│   ├── FileEditTool.js
│   ├── FileReadTool.js
```


---

## 📄 Core Files

- **main.js**: Electron main process - handles window creation, IPC communication
- **preload.js**: Preload script - exposes secure API to renderer process
- **systemPrompt.md**: System prompt defining AI behavior, tool usage rules, and coding guidelines
- **README.md**: Project documentation and usage instructions
- **package.json**: Project configuration, dependencies, and build scripts

---

## 🔧 Tool System Architecture

The tool system consists of:
- **ToolRegistry**: Central registry for all available tools
- **UnifiedToolManager**: Manages tool execution and lifecycle
- **ToolBridge**: Bridges between AI requests and tool implementations
- **Individual Tools**: Specialized tools for specific operations

Tools are organized in the `/tools/` directory and follow a consistent interface.

---

## 🛠️ Available Tools API Reference

Available tools (all functions are async, use await):

### readFile
```typescript
readFile(filePath: string, encoding?: string): Promise<string>
```
Read file content. Returns first 1MB if larger.

### readFileWithLines
```typescript
readFileWithLines(filePath: string, encoding?: string): Promise<string>
```
Read file with line numbers prefixed (format: "line: content")

### writeFile
```typescript
writeFile(filePath: string, content: string, encoding?: string): Promise<FileWriteResult>
```
Create or overwrite file. Auto-creates parent directories.

### editFile
```typescript
editFile(filePath: string, oldString: string, newString: string, replaceAll?: boolean): Promise<FileEditResult>
```
Precise string replacement in files. Requires exact match.

### deleteFile
```typescript
deleteFile(filePath: string): Promise<FileDeleteResult>
```
Delete a file permanently. Cannot delete directories.

### glob
```typescript
glob(pattern: string, searchPath?: string): Promise<string[]>
```
Search files by glob pattern. Skips node_modules, .git, dist.

### grep
```typescript
grep(pattern: string, options?: GrepOptions): Promise<GrepResult>
```
Search content by regex/text. Returns matches with line numbers.

### bash
```typescript
bash(command: string, options?: BashOptions): Promise<BashResult>
```
Execute shell commands. Does not throw on failure - check exitCode.

### mysql
```typescript
mysql(options: MysqlOptions): Promise<MysqlResult>
```
Execute MySQL queries. Supports parameterized queries.

### webFetch
```typescript
webFetch(url: string, options?: WebFetchOptions): Promise<WebFetchResult>
```
Fetch HTTP/HTTPS URLs. Returns structured response.

### log
```typescript
log(...args: unknown[]): void
```
Output intermediate results to execution log.


---

## 💡 Usage Patterns & Examples

## Common Patterns

### Reading and Understanding Code
```javascript
// Read a file to understand its content
const content = await readFile('src/main.js');

// Read with line numbers for precise discussion
const linedContent = await readFileWithLines('src/utils/helper.js');
```

### Making Surgical Edits
```javascript
// Edit with exact string matching
await editFile('src/app.js', 
  'old function code here',
  'new function code here'
);
```

### Searching the Codebase
```javascript
// Find all JS files in src
const jsFiles = await glob('**/*.js', 'src');

// Search for specific pattern
const matches = await grep('console\.log', { ignoreCase: false });
```

### Executing Commands
```javascript
// Run npm install
const result = await bash('npm install');
if (result.exitCode !== 0) {
  log('Install failed:', result.stderr);
}
```

### Database Operations
```javascript
// Query MySQL
const result = await mysql({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'mydb',
  query: 'SELECT * FROM users WHERE id = ?',
  params: [123]
});
```

---

## 🔄 Agent Interaction Workflow

## Agent Workflow

1. **Initialize**: Read agent.md to understand project context
2. **Receive Command**: Wait for user instruction (e.g., "Add user authentication")
3. **Analyze**: 
   - Read relevant files using readFile/glob/grep
   - Understand current implementation
   - Identify required changes
4. **Plan**: Present a clear plan:
   - What files will be modified
   - What changes will be made
   - Any risks or considerations
5. **Confirm**: Ask user for approval before making changes
6. **Execute**: 
   - Make surgical edits using editFile/writeFile
   - Run tests or commands if needed
   - Verify changes work correctly
7. **Report**: Summarize what was done and any next steps

### Key Principles
- Always read before writing
- Make minimal, precise changes
- Ask clarifying questions when requirements are unclear
- Never assume - verify assumptions by reading code
- Test changes when possible

---

## ⚠️ Rules and Constraints

## Rules and Constraints

### Safety Rules
- Do not execute dangerous commands (format, shutdown, taskkill, diskpart, reg delete)
- Do not modify files outside project directory
- Do not delete files without explicit user request
- Always backup important data before major changes

### Coding Standards
- Prefer simple solutions over complex ones
- Avoid over-engineering or premature optimization
- Write readable, maintainable code
- Follow existing code style and patterns

### Modification Guidelines
- Make surgical, targeted changes
- Do not reformat or refactor unrelated code
- Each edit should have a single clear purpose
- Verify oldString uniqueness before editing

### Communication
- Be concise and professional
- Show code and command output directly
- For multi-step tasks, present plan first
- Ask questions when requirements are ambiguous
- Explain how changes solve the problem

---

## ✅ Common Task Examples

### Task 1: Add User Authentication

**User Request**: "Add JWT authentication to the login system"

**Agent Steps**:
1. Read current auth implementation: `await readFile('src/auth/login.js')`
2. Search for related files: `await glob('**/*auth*.js')`
3. Present plan: "I will modify X, Y, Z files to add JWT..."
4. Wait for user confirmation
5. Execute: `await editFile(...)` for each file
6. Test: `await bash('npm test')`
7. Report: "Authentication added. Files modified: ..."

### Task 2: Fix a Bug

**User Request**: "The app crashes when deleting empty files"

**Agent Steps**:
1. Search for delete logic: `await grep('deleteFile', { path: 'tools' })`
2. Read the FileDeleteTool: `await readFile('tools/FileDeleteTool.js')`
3. Identify the bug (e.g., no empty check)
4. Present fix plan with code snippet
5. After confirmation, apply: `await editFile('tools/FileDeleteTool.js', ...)`
6. Verify fix works

### Task 3: Add New Feature

**User Request**: "Add support for PostgreSQL database"

**Agent Steps**:
1. Read existing MySQL tool: `await readFile('tools/MySQLTool.js')`
2. Understand the tool interface pattern
3. Create new PostgresTool following same pattern
4. Register in ToolRegistry
5. Update documentation
6. Present all changes for review before committing

### Task 4: Refactor Code

**User Request**: "Improve error handling in file operations"

**Agent Steps**:
1. Analyze current error handling: `await grep('try\s*{', { path: 'tools' })`
2. Identify files needing improvement
3. Propose standardized error handling pattern
4. Apply changes one file at a time
5. Test each change before moving to next

---

*Generated by AgentDocGenerator - Keep this file updated when project structure changes*
