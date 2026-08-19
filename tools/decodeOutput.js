/**
 * commandOutputsmartdecode
 * Chinese Windows 上控制台default代码页是 GBK（cp936），而 Node of exec default按 UTF-8 decode，
 * 导致 PowerShell/cmd OutputofChinese变成 "�"。
 * 策略：先按 UTF-8 decode；if出现替换符（U+FFFD），说明bytes流not是合法 UTF-8，
 * 回退按 GBK decode。
 * @param {Buffer} buf - exec Outputof原始bytes
 * @returns {string} decode后oftext
 */
function decodeOutput(buf) {
  if (!buf || buf.length === 0) return '';
  const utf8 = buf.toString('utf8');
  if (utf8.includes('\uFFFD')) {
    try {
      const gbk = new TextDecoder('gbk').decode(buf);
      if (!gbk.includes('\uFFFD')) return gbk;
    } catch (e) {
      // TextDecoder notsupport gbk ofenvironment，退回 UTF-8 result
    }
  }
  return utf8;
}

/**
 * 修正 AI generated PowerShell commandof编码problem：
 * Windows PowerShell 5.1 of Get-Content default按 GBK（ANSI）Readingfile，导致 UTF-8 fileChinesegarbled text
 * （表现as"绛夊緟鏂"这类字符）。ifcommandcall powershell/pwsh 且contain Get-Content，
 * 自动注入 -Encoding UTF8（已带 -Encoding ofcommandnot动）。
 * @param {string} command - 原始command
 * @returns {string} 修正后ofcommand
 */
function normalizeCommand(command) {
  if (typeof command !== 'string' || !command) return command;
  const trimmed = command.trim();
  // 仅处理 powershell / pwsh call
  if (!/^(powershell|pwsh)(\.exe)?(\s|$)/i.test(trimmed)) return command;
  if (!trimmed.includes('Get-Content')) return command;
  // 已显式指定编码ofcommandnot动
  if (/-Encoding\s+/i.test(trimmed)) return command;
  return command.replace(/Get-Content\b/g, 'Get-Content -Encoding UTF8');
}

module.exports = { decodeOutput, normalizeCommand };
