const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.yaml', '.yml', '.toml', '.ini', '.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.go', '.rs', '.swift', '.html', '.css', '.scss', '.vue', '.svelte', '.sql', '.sh', '.bat', '.ps1']);
const IGNORED_SEGMENTS = new Set(['.git', '.hg', '.svn', 'node_modules', 'vendor', 'dist', 'build', 'coverage', '.venv', 'venv', '__pycache__']);
function reply(id, result, error) { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: id, ...(error ? { error: { code: error.code || -32000, message: error.message || 'Worker failed' } } : { result: result }) }) + '\n'); }
function invalid(message) { const error = new Error(message); error.code = -32602; return error; }
function safeRelative(value) { if (typeof value !== 'string' || !value.trim() || value.length > 260) throw invalid('文件路径无效。'); const normalized = value.replaceAll('\\', '/'); if (path.posix.isAbsolute(normalized) || normalized.split('/').some((part) => part === '..' || part === '')) throw invalid('文件路径必须是项目目录内的相对路径。'); const parts = normalized.split('/'); if (parts.some((part) => !part || IGNORED_SEGMENTS.has(part) || part.startsWith('.'))) throw invalid('文件路径包含被忽略的目录或隐藏文件。'); return parts.join(path.sep); }
async function readContext(params) {
  const root = typeof params?.root === 'string' ? path.resolve(params.root) : ''; if (!root) throw invalid('没有收到项目目录。'); const files = Array.isArray(params.files) ? params.files.slice(0, 64) : []; const maxBytes = Number.isSafeInteger(params.maxBytes) ? Math.min(Math.max(params.maxBytes, 1000), 500000) : 240000; const entries = []; const omitted = []; let used = 0;
  for (const raw of files) {
    let relative; try { relative = safeRelative(raw); } catch { omitted.push({ path: String(raw), reason: '路径不安全' }); continue; }
    const absolute = path.resolve(root, relative); if (absolute !== root && !absolute.startsWith(root + path.sep)) { omitted.push({ path: raw, reason: '路径越界' }); continue; }
    try { const stat = await fs.lstat(absolute); if (!stat.isFile() || stat.isSymbolicLink()) { omitted.push({ path: raw, reason: '不是普通文件' }); continue; } if (stat.size > 240000) { omitted.push({ path: raw, reason: '文件过大' }); continue; } if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) { omitted.push({ path: raw, reason: '非文本文件' }); continue; } const buffer = await fs.readFile(absolute); if (buffer.includes(0)) { omitted.push({ path: raw, reason: '疑似二进制文件' }); continue; } if (used + buffer.length > maxBytes) { omitted.push({ path: raw, reason: '超过本次资料预算' }); continue; } used += buffer.length; const content = buffer.toString('utf8'); entries.push({ source: 'project', id: relative.replaceAll(path.sep, '/'), title: relative.replaceAll(path.sep, '/'), text: content.slice(0, 12000) }); }
    catch { omitted.push({ path: raw, reason: '读取失败或文件不存在' }); }
  }
  return { entries: entries, omitted: omitted, bytes: used };
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => { let request; try { request = JSON.parse(line); } catch { reply(null, null, Object.assign(new Error('Parse error'), { code: -32700 })); return; } try { if (request.method === 'read_context') reply(request.id, await readContext(request.params || {})); else throw Object.assign(new Error('Method not found'), { code: -32601 }); } catch (error) { reply(request.id, null, error); } });
