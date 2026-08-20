# 🤖 AI Agent Workflow Guide

## Overview

This guide explains the new AI-powered development workflow for Cuckoo Code, where DeepSeek (or any AI assistant) can understand, modify, and extend the codebase through natural language commands.

## How It Works

### Step 1: Generate Agent Knowledge Base

Before starting any AI-assisted development, generate the `agent.md` file:

```bash
node scripts/generate-agent-doc.js
```

This creates a comprehensive `agent.md` file containing:
- Project structure overview
- Core files description
- Complete tool API reference
- Usage patterns and examples
- Agent interaction workflow
- Rules and constraints
- Common task examples

### Step 2: Provide Context to AI

Copy the entire contents of `agent.md` and paste it into your AI chat (DeepSeek, Claude, etc.) with an instruction like:

```
Please read and understand this project documentation. I will give you tasks to perform on this codebase.
[Paste agent.md content here]
```

### Step 3: Give Commands

Once the AI has read and understood the documentation, you can give natural language commands such as:

#### Examples:

**Bug Fixes:**
- "The app crashes when deleting empty files. Find and fix the bug."
- "There's an error in the file reading function. Investigate and repair it."

**Feature Requests:**
- "Add JWT authentication to the login system."
- "I need PostgreSQL database support in addition to MySQL."
- "Create a new tool for sending email notifications."

**Refactoring:**
- "Improve error handling across all file operations."
- "Standardize the logging format in all tools."

**Updates:**
- "Update the dependencies to their latest versions."
- "Migrate from the old API to the new REST endpoints."

### Step 4: Review the Plan

The AI should follow this workflow:

1. **Analyze**: Read relevant files using `readFile()`, `glob()`, or `grep()`
2. **Plan**: Present a clear plan explaining:
   - Which files will be modified
   - What changes will be made
   - Any risks or considerations
3. **Wait**: Pause for your confirmation
4. **Execute**: Make the changes after you approve
5. **Report**: Summarize what was done

### Step 5: Confirm and Execute

Review the AI's proposed plan, ask clarifying questions if needed, then confirm:

```
Yes, proceed with the changes.
```

Or request modifications:

```
Actually, let's also add validation for user input before making those changes.
```

## Best Practices

### For Users:

1. **Always review plans** before approving changes
2. **Ask for explanations** if something is unclear
3. **Request tests** for critical changes
4. **Commit frequently** to maintain version history
5. **Provide context** about your goals and constraints

### For AI Agents:

1. **Read before writing** - Never modify files without understanding them first
2. **Be surgical** - Make minimal, targeted changes
3. **Communicate clearly** - Explain what you're doing and why
4. **Ask questions** - When requirements are ambiguous
5. **Verify changes** - Test before reporting completion
6. **Follow conventions** - Match existing code style and patterns

## Available Tools

The AI has access to these tools via the ```cuckoo code block syntax:

| Tool | Purpose |
|------|---------|
| `readFile()` | Read file contents |
| `readFileWithLines()` | Read with line numbers |
| `writeFile()` | Create/overwrite files |
| `editFile()` | Precise string replacement |
| `deleteFile()` | Delete files |
| `glob()` | Search files by pattern |
| `grep()` | Search content by regex |
| `bash()` | Execute shell commands |
| `mysql()` | Query MySQL databases |
| `webFetch()` | Fetch HTTP/HTTPS URLs |
| `log()` | Output to execution log |

All tools are async - must use `await`.

## Example Session

```
User: [Pastes agent.md] Please learn this project structure.

AI: I've reviewed the Cuckoo Code project documentation. I understand the 
    architecture, available tools, and development workflow. Ready for your 
    instructions.

User: Add rate limiting to the web fetch tool to prevent API abuse.

AI: I'll analyze the current WebFetchTool implementation and add rate limiting.
    
    Plan:
    1. Read WebFetchTool.js to understand current implementation
    2. Add rate limiting logic (max 10 requests per minute per domain)
    3. Add configuration option for custom limits
    4. Update TypeScript definitions
    5. Add tests for rate limiting behavior
    
    Files to modify:
    - tools/WebFetchTool.js
    - tools/cuckoo-tools.d.ts
    
    Should I proceed?

User: Yes, but make the default limit 5 requests per minute instead of 10.

AI: Understood. Implementing with 5 requests/minute default...
    
    [Executes changes]
    
    Changes completed:
    ✅ Added rate limiter class
    ✅ Integrated into WebFetchTool
    ✅ Added configurable limit option
    ✅ Updated type definitions
    ✅ Added usage examples
    
    The rate limiter tracks requests per domain and enforces the limit. 
    Users can customize via: webFetch(url, { rateLimit: 10 })
```

## Troubleshooting

### AI Makes Mistakes

If the AI makes incorrect changes:
1. Ask it to revert the changes
2. Provide more specific guidance
3. Break down complex tasks into smaller steps

### AI Doesn't Understand

If the AI seems confused:
1. Re-share relevant parts of agent.md
2. Provide more context about your requirements
3. Show examples of similar implementations

### Need More Control

For fine-grained control:
1. Request step-by-step execution
2. Ask for code snippets before applying
3. Require tests for each change

## Integration with GitHub Actions

After AI completes changes:

1. **Review the changes** in your local environment
2. **Test thoroughly** to ensure everything works
3. **Commit with descriptive messages**:
   ```bash
   git add .
   git commit -m "feat: Add rate limiting to WebFetchTool"
   git push
   ```
4. **Create a tag** to trigger automated build:
   ```bash
   git tag v0.1.5
   git push origin v0.1.5
   ```
5. **Download the new .exe** from GitHub Releases

## Security Considerations

⚠️ **Important Safety Rules:**

- AI cannot execute dangerous commands (format, shutdown, taskkill, etc.)
- AI cannot modify files outside the project directory
- AI cannot delete files without explicit request
- Always review changes before committing
- Keep sensitive data (API keys, passwords) out of the codebase

## Next Steps

1. Generate agent.md for your project
2. Share it with your AI assistant
3. Start giving natural language commands
4. Enjoy accelerated development! 🚀

---

*For questions or issues, refer to the main README.md or CONTRIBUTING.md*
