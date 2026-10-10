// Operator-run integration check: installed Pi MCP manager/bridge, no model inference.
// Run offline first. --live performs one explicitly requested public metadata search.
// Use a sanitized environment, read-only project/toolchain and disposable HOME.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const piRoot = process.env.PI_PACKAGE_ROOT;
const extensionRoot = process.env.PI_MCP_PACKAGE_ROOT;
assert(piRoot && extensionRoot, 'Explicit installed runtime paths required');
assert(homedir().startsWith('/scratch/'), 'Disposable sandbox HOME required');
const require = createRequire(join(piRoot, 'package.json'));
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { fsCache: false });
const { loadConfig } = await jiti.import(join(extensionRoot, 'src/config.ts'));
const { ServerManager } = await jiti.import(join(extensionRoot, 'src/server-manager.ts'));
const { ToolBridge } = await jiti.import(join(extensionRoot, 'src/tool-bridge.ts'));

const raw = JSON.parse(await readFile(join(root, 'example-client-config.json'), 'utf8'));
assert.deepEqual(Object.keys(raw.mcpServers), ['research']);
// Resolve the portable template only into this checkout and disposable HOME.
raw.mcpServers.research.args = raw.mcpServers.research.args.map(arg => arg
  .replaceAll('/ABSOLUTE/PATH/TO/research-mcp', root)
  .replaceAll('/ABSOLUTE/PATH/TO/HOME', homedir()));
raw.settings = { maxRetries: 0 }; // A failed check must not auto-loop/restart.
const configDir = join(homedir(), '.pi/agent');
await mkdir(configDir, { recursive: true, mode: 0o700 });
await writeFile(join(configDir, 'mcp.json'), JSON.stringify(raw), { mode: 0o600 });
const config = await loadConfig(root);
assert.deepEqual(Object.keys(config.mcpServers), ['research']);
assert.equal(config.mcpServers.research.lifecycle, 'lazy');
// A caller's working directory must not shadow the configured Python package.
await mkdir('/scratch/foreign-cwd', { recursive: true });
await writeFile('/scratch/foreign-cwd/originium_research_mcp.py', 'raise RuntimeError("unsafe cwd import")\n');
process.chdir('/scratch/foreign-cwd');

const tools = new Map();
let active = ['read'];
const pi = {
  registerTool: tool => tools.set(tool.name, tool),
  getActiveTools: () => [...active],
  setActiveTools: names => { active = names; },
};
const manager = new ServerManager(config);
const bridge = new ToolBridge(config.settings, pi);
manager.setToolRefreshCallback((name, client) => bridge.refreshTools(name, client));
async function call(tool, args) {
  const registered = tools.get(`mcp_research_${tool}`);
  assert(registered, `Missing registered tool: ${tool}`);
  const result = await registered.execute('integration-check', args, undefined, undefined, {});
  assert.equal(result.content.length, 1);
  return JSON.parse(result.content[0].text);
}

try {
  await manager.startServer('research', root);
  const server = manager.getServer('research');
  assert.equal(server.state, 'ready', 'Stdio handshake must succeed');
  assert.equal(tools.size, 5);
  assert(active.includes('read') && active.includes('mcp_research_search_papers'));
  const status = await call('provider_status', {});
  assert.equal(status.openalex_api_key_configured, false);
  assert.equal(status.crossref_contact_configured, false);
  const edinburgh = await call('edinburgh_access', { doi: '10.2469/faj.v58.n4.2453' });
  assert.equal(edinburgh.entitlement, 'unknown');
  assert(edinburgh.discovery_url.startsWith('https://discovered.ed.ac.uk/'));
  await assert.rejects(() => call('search_papers', { query: 'example', limit: 11 }));
  console.log(JSON.stringify({ check: 'pi_bridge_offline', status: 'passed', tools: [...tools.keys()], credentials: 'none' }));
  if (process.argv.includes('--live')) {
    const sources = process.argv.includes('--openalex-only') ? ['openalex'] : ['crossref', 'openalex', 'arxiv'];
    const result = await call('search_papers', { query: 'cryptocurrency momentum', sources, limit: 1 });
    console.log(JSON.stringify({ check: 'public_search', query: 'cryptocurrency momentum', sources, status: result.status,
      records: result.records.map(r => ({ source: r.source, title: r.title, doi: r.doi, arxiv_id: r.arxiv_id })), errors: result.errors }));
    assert(['ok', 'partial'].includes(result.status) && result.records.length > 0, 'No live provider result');
  }
} finally {
  bridge.deactivateServer('research');
  await manager.shutdownAll();
  assert.deepEqual(active, ['read']);
  assert(manager.getAllServers().every(s => s.state === 'stopped'));
  const lock = join(homedir(), '.cache/originium-research-mcp/instance.lock');
  const acquired = spawnSync('/usr/bin/python3', ['-I', '-c',
    'import fcntl,sys; f=open(sys.argv[1],"r+"); fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB); f.close()', lock],
    { env: { PATH: '/usr/bin:/bin' }, timeout: 5000, encoding: 'utf8' });
  assert.equal(acquired.status, 0, 'Server instance lock must be released after shutdown');
  console.log(JSON.stringify({ check: 'pi_bridge_shutdown', status: 'passed', toolsDeactivated: true, lockReleased: true }));
}
