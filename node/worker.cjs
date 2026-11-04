const fs = require('node:fs/promises');
const path = require('node:path');
const readline = require('node:readline');
const { extractPdf } = require('./pdf.cjs');
// PDF.js warnings must never enter the JSON-RPC stdout stream.
console.log = (...args) => console.error(...args);
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
    try { const realRoot = await fs.realpath(root); const real = await fs.realpath(absolute); if (real !== realRoot && !real.startsWith(realRoot + path.sep)) { omitted.push({ path: raw, reason: '符号链接路径越界' }); continue; } const stat = await fs.lstat(real); if (!stat.isFile() || stat.isSymbolicLink()) { omitted.push({ path: raw, reason: '不是普通文件' }); continue; } if (stat.size > 240000) { omitted.push({ path: raw, reason: '文件过大' }); continue; } if (!TEXT_EXTENSIONS.has(path.extname(relative).toLowerCase())) { omitted.push({ path: raw, reason: '非文本文件' }); continue; } const buffer = await fs.readFile(real); if (buffer.includes(0)) { omitted.push({ path: raw, reason: '疑似二进制文件' }); continue; } if (used + buffer.length > maxBytes) { omitted.push({ path: raw, reason: '超过本次资料预算' }); continue; } used += buffer.length; const content = buffer.toString('utf8'); entries.push({ source: 'project', id: relative.replaceAll(path.sep, '/'), title: relative.replaceAll(path.sep, '/'), text: content }); }
    catch { omitted.push({ path: raw, reason: '读取失败或文件不存在' }); }
  }
  return { entries: entries, omitted: omitted, bytes: used };
}
function projectTerms(value) {
  const words = String(value || '').toLowerCase().match(/[a-z0-9_]{2,}|[\u4e00-\u9fff]{2,}/g) || [];
  return [...new Set(words.flatMap(word => /[\u4e00-\u9fff]/.test(word) ? Array.from({length:word.length-1},(_,i)=>word.slice(i,i+2)) : [word]))].slice(0,80);
}
async function scanProject(params) {
  if (typeof params.root !== 'string' || !path.isAbsolute(params.root)) throw invalid('请选择本机项目目录。');
  const root = await fs.realpath(params.root);
  const query = projectTerms(params.query);
  const candidates = [], queue = [{dir:root,depth:0}];
  let visited = 0, incomplete = false;
  while (queue.length && visited < 6000) {
    const {dir,depth} = queue.shift();
    let children;
    try { children = await fs.readdir(dir,{withFileTypes:true}); } catch { incomplete = true; continue; }
    children.sort((a,b)=>a.name.localeCompare(b.name));
    for (const item of children) {
      visited++;
      if (visited > 6000) { incomplete = true; break; }
      if (item.name.startsWith('.') || IGNORED_SEGMENTS.has(item.name) || /^(?:credentials|secrets?|tokens?|auth|passwords?)(?:\.|$)/i.test(item.name)) continue;
      if (item.isSymbolicLink()) continue;
      const filename = path.join(dir,item.name);
      if (item.isDirectory()) { if(depth<7)queue.push({dir:filename,depth:depth+1});else incomplete=true; continue; }
      if (!item.isFile() || !TEXT_EXTENSIONS.has(path.extname(item.name).toLowerCase()) && path.extname(item.name).toLowerCase() !== '.pdf') continue;
      const relative = path.relative(root,filename).replaceAll(path.sep,'/');
      const lower = relative.toLowerCase();
      const score = query.reduce((n,term)=>n+(lower.includes(term)?4:0),0) + (/readme|plan|design|spec|需求|方案|设计|记录|会议/.test(lower)?3:0) + (/\.md$|\.txt$|\.pdf$/.test(lower)?1:0);
      candidates.push({relative,score});
    }
  }
  if(queue.length)incomplete=true;
  candidates.sort((a,b)=>b.score-a.score || a.relative.localeCompare(b.relative));
  const all = [];
  let bytes = 0, filesRead = 0;
  const pdfWarnings=[];let pdfPages=0,pdfFiles=0,pdfBytes=0,examined=0;
  for (const item of candidates) {
    if (filesRead>=100 || bytes>=2000000 || examined++>=200) break;
    let result;
    if(path.extname(item.relative).toLowerCase()==='.pdf') {
      const absolute=await fs.realpath(path.resolve(root,item.relative));
      if(!absolute.startsWith(root+path.sep))continue;
      let stat;try{stat=await fs.stat(absolute);}catch{continue;}
      if(stat.size>12*1024*1024){pdfWarnings.push({file:item.relative,code:'PDF_TOO_LARGE'});continue;}
      if(pdfFiles>=12 || pdfBytes+stat.size>32*1024*1024){pdfWarnings.push({file:item.relative,code:'PDF_TRUNCATED'});continue;}
      pdfBytes+=stat.size;
      const parsed=await extractPdf(await fs.readFile(absolute));
      pdfFiles++;pdfPages+=parsed.pages.length;
      if(parsed.warning)pdfWarnings.push({file:item.relative,code:parsed.warning});
      result={entries:parsed.pages.map(page=>({source:'project',id:item.relative+'#page='+page.number,title:item.relative+'（第 '+page.number+' 页）',text:page.text})),bytes:parsed.pages.reduce((n,p)=>n+Buffer.byteLength(p.text),0)};
    } else result=await readContext({root,files:[item.relative],maxBytes:240000});
    if (!result.entries.length) continue;
    filesRead++;bytes+=result.bytes;
    for(const entry of result.entries) {
      const pieces = entry.text.match(/[\s\S]{1,1600}/g) || [];
      pieces.forEach((text,position)=>all.push({...entry,text,position,score:item.score+query.reduce((n,term)=>n+(text.toLowerCase().includes(term)?2:0),0)}));
    }
  }
  all.sort((a,b)=>b.score-a.score || a.position-b.position);
  const entries=[];let chars=0;
  for(const item of all){if(chars+item.text.length>36000)continue;entries.push({source:item.source,id:item.id,title:item.title,text:item.text});chars+=item.text.length;}
  return {entries, scanned:candidates.length,filesRead,visited,incomplete:incomplete || filesRead<candidates.length,sourceCount:new Set(entries.map(x=>x.id.split('#page=')[0])).size,pdf:{files:pdfFiles,pages:pdfPages,warnings:pdfWarnings.slice(0,20)}};
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => { let request; try { request = JSON.parse(line); } catch { reply(null, null, Object.assign(new Error('Parse error'), { code: -32700 })); return; } try { if (request.method === 'scan_project') reply(request.id, await scanProject(request.params || {})); else if (request.method === 'read_context') reply(request.id, await readContext(request.params || {})); else throw Object.assign(new Error('Method not found'), { code: -32601 }); } catch (error) { reply(request.id, null, error); } });

module.exports={readContext,scanProject,safeRelative};
