const { Tool, ToolResult } = require('./ToolRegistry');
const { exec } = require('child_process');
const path = require('path');
const { decodeOutput, normalizeCommand } = require('./decodeOutput');

// 危险commandlist（与 main.js of execute-command 一致），匹配ofcommand会be拒绝
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

/**
 * Bash Execute tool - 仿照 Claude Code of Bash Tool
 * execute shell commandandreturnOutput（Windows use cmd.exe，Linux/Mac use sh，跨平台）
 */
class BashTool extends Tool {
  constructor() {
    super(
      'bash', 'execute shell command（Windows use cmd.exe），return stdout/stderr/exitCode。危险command会be安全策略拒绝。',
      {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: '要executeof shell command'
          },
          cwd: {
            type: 'string',
            description: 'commandofworkdirectory（relativepath），defaultproject根directory'
          },
          timeout: {
            type: 'number',
            description: '超whenwhen间（毫秒），default 30000',
            default: 30000
          }
        },
        required: ['command'],
        additionalProperties: false
      },
      'bash(command, options?)'
    );
  }

  /**
   * execute shell command
   * @param {Object} params - { command, cwd?, timeout?, projectDir? }
   * @returns {Promise<ToolResult>}
   */
  async execute(params) {
    const { command, cwd, timeout = 30000, projectDir } = params;

    try {
      if (!command || typeof command !== 'string') {
        return ToolResult.error('command not能empty');
      }

      const trimmed = normalizeCommand(command.trim());
      if (!trimmed) {
        return ToolResult.error('command not能empty');
      }

      // 危险commandcheck
      if (DANGEROUS_CMDS.some((p) => p.test(trimmed))) {
        console.log('[BashTool] ⚠️ 拒绝危险command:', trimmed);
        return ToolResult.error('commandbe安全策略拒绝（匹配危险commandlist）: ' + trimmed);
      }

      // determineworkdirectory
      let workDir;
      if (cwd) {
        const normalized = cwd.replace(/\//g, path.sep);
        workDir = path.isAbsolute(normalized)
          ? normalized
          : (projectDir ? path.join(projectDir, normalized) : path.resolve(normalized));
      } else if (projectDir) {
        workDir = projectDir;
      } else {
        workDir = process.env.USERPROFILE || process.env.HOME || 'C:\\';
      }

      console.log(`[BashTool] executecommand: ${trimmed}, cwd=${workDir}`);

      return await new Promise((resolve) => {
        exec(
          trimmed,
          {
            cwd: workDir,
            timeout: timeout,
            maxBuffer: 1024 * 1024, // 1MB
            windowsHide: true,
            encoding: 'buffer',
          },
          (error, stdout, stderr) => {
            const out = decodeOutput(stdout);
            const err = decodeOutput(stderr);
            if (error) {
              resolve(ToolResult.error(
                'Command execution failed: ' + error.message + String.fromCharCode(10) +
                'stdout: ' + (out || '(empty)') + String.fromCharCode(10) +
                'stderr: ' + (err || '(empty)')
              ));
            } else {
              resolve(ToolResult.success({
                message: 'Command executed successfully',
                command: trimmed,
                cwd: workDir,
                stdout: out,
                stderr: err,
                exitCode: 0,
              }));
            }
          }
        );
      });
    } catch (err) {
      return ToolResult.error(`commandexecution exception: ${err.message}`);
    }
  }
}

module.exports = { BashTool, DANGEROUS_CMDS };