/**
 * 测试统一ToolCall Formatparse
 */

const { WebContentCapturer } = require('./WebContentCapturer');
const { UnifiedToolManager } = require('./UnifiedToolManager');

async function test() {
  console.log('=== 测试Toolcallparse ===\n');

  // Create toolManager 实例
  const toolManager = new UnifiedToolManager();

  // Create parser 实例
  const parser = new WebContentCapturer(toolManager);

  // 测试用例
  const testCases = [
    {
      name: 'standard format JSON (toolName/params)',
      content: '{"toolName": "file_write", "params": {"file_path": "test.txt", "content": "hello"}, "callId": "call_123"}'
    },
    {
      name: 'AI replyformat (tool/parameters)',
      content: '{"tool": "file_write", "parameters": {"file_path": "C:\\\\d\\\\SourceCode\\\\2026\\\\at-geo-web\\\\abc.json", "content": ""}}'
    },
    {
      name: 'JSON code block',
      content: '```json\n{"toolName": "file_write", "params": {"file_path": "test.txt", "content": "hello"}}\n```'
    },
    {
      name: 'tool code block',
      content: '```tool\n{"toolName": "file_write", "params": {"file_path": "test.txt", "content": "hello"}}\n```'
    },
    {
      name: 'Nonecode blockmarkof JSON',
      content: '{"toolName": "file_write", "params": {"file_path": "test.txt", "content": "hello"}}'
    },
    {
      name: 'contain额外text',
      content: '我要写入file：\n```json\n{"toolName": "file_write", "params": {"file_path": "test.txt", "content": "hello"}}\n```\npleaseexecute。'
    },
    {
      name: 'AI reply风格',
      content: '好of，我来帮你写入file。\n\n```json\n{\n  "toolName": "file_write",\n  "params": {\n    "file_path": "src/utils/helper.js",\n    "content": "export function formatDate(date) {\\n  return date.toISOString().split(\\"T\\")[0];\\n}"\n  },\n  "callId": "call_1700000001_abc123"\n}\n```\n\nfile已写入。'
    },
    {
      name: 'Errorformat - missing toolName',
      content: '{"params": {"file_path": "test.txt", "content": "hello"}}'
    },
    {
      name: '普通text（非Toolcall）',
      content: '这是一段普通ofreply，notcontainToolcall。'
    }
  ];

  for (const tc of testCases) {
    console.log(`\n--- ${tc.name} ---`);
    console.log('输入:', tc.content.substring(0, 80) + (tc.content.length > 80 ? '...' : ''));

    const result = parser.parseToolCall(tc.content);
    if (result) {
      console.log('✅ parsesuccess:');
      console.log('  toolName:', result.toolName);
      console.log('  params:', JSON.stringify(result.params));
      console.log('  callId:', result.callId);
    } else {
      console.log('❌ not识别asToolcall');
    }
  }

  // 测试Toolexecute
  console.log('\n=== 测试Toolexecute ===\n');
  const testToolCall = {
    toolName: 'file_write',
    params: {
      file_path: 'test_output.txt',
      content: '测试content\n测试when间: ' + new Date().toISOString()
    },
    callId: 'test_call_001'
  };

  console.log('Execute tool:', testToolCall.toolName);
  const result = await toolManager.execute(testToolCall);
  console.log('executeresult:', result.success ? '✅ Success' : '❌ Failed');
  console.log('数据:', result.data);
  console.log('Error:', result.error);

  // Validatefile
  const fs = require('fs');
  if (fs.existsSync('test_output.txt')) {
    const content = fs.readFileSync('test_output.txt', 'utf-8');
    console.log('\nfilecontentValidate:');
    console.log(content);
    fs.unlinkSync('test_output.txt');
    console.log('测试file已clean');
  }

  console.log('\n=== 测试complete ===');
}

test().catch(console.error);