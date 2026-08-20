/**
 * Generate agent.md documentation for Cuckoo Code project
 * This script scans the project and creates a comprehensive knowledge base
 * that helps AI assistants understand the project quickly.
 */

const fs = require('fs');
const path = require('path');
const { AgentDocGenerator } = require('../tools/AgentDocGenerator');

async function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const outputPath = path.join(projectRoot, 'agent.md');
  
  console.log('🔍 Scanning project structure...');
  
  const generator = new AgentDocGenerator(projectRoot);
  const agentDoc = await generator.generateAgentDoc();
  
  console.log('📝 Writing agent.md...');
  fs.writeFileSync(outputPath, agentDoc, 'utf-8');
  
  console.log(`✅ Generated: ${outputPath}`);
  console.log('\n--- Preview ---\n');
  console.log(agentDoc.substring(0, 2000) + '...\n');
}

main().catch(console.error);
