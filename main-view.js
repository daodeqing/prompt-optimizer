const channel = new BroadcastChannel('prompt-optimizer');
const $ = selector => document.querySelector(selector);
const pending = new Map();
let saved = { revision: 0, route: null, category: 'auto', length: 'auto' };
let catalog = [], result = null, activeId = null, polling = false, starting = false, destroyed = false, selectedProject = null;
let readyPromise = null, readyResolve = null;
const storageKey = 'prompt-optimizer-active-v2';
function key(prefix) { return prefix + '-' + crypto.randomUUID(); }
function setStatus(message, state) { $('#status').textContent = message; $('#status').dataset.state = state || 'idle'; }
function remember(id) { activeId = id; try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch (_) {} }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function selected(select) { return [...select.selectedOptions].map(option => option.value).filter(Boolean); }
function modelKey(route) { return route.agentKind + '|' + route.providerId + '|' + route.model; }
function candidateRoute() {
  const item = catalog.find(entry => modelKey(entry.route) === $('#model').value);
  return item ? { ...item.route, effort: $('#effort').value, fastMode: $('#fastMode').value === 'ultrafast' ? 'ultrafast' : $('#fastMode').value === 'true' } : null;
}
function modelDirty() { const value = candidateRoute(); return !!value && !same(value, saved.route); }
function controls() {
  $('#optimizeBtn').disabled = starting || !!activeId || !selectedProject || !saved.route || !candidateRoute() || modelDirty();
  $('#cancelBtn').hidden = !activeId;
  $('#resumeBtn').hidden = !activeId || polling;
}
async function ready() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    let interval;
    const timeout = setTimeout(() => { clearInterval(interval); readyPromise = null; reject(new Error('插件未就绪，请重新打开工作台。')); }, 12000);
    readyResolve = () => { clearTimeout(timeout); clearInterval(interval); resolve(); };
    fetch('/wake').then(response => { if (!response.ok) throw new Error('无法唤醒插件'); const ping = () => channel.postMessage({ type: 'ui-ping' }); interval = setInterval(ping, 250); ping(); }).catch(error => { clearTimeout(timeout); readyPromise = null; reject(error); });
  });
  return readyPromise;
}
async function request(action, payload = {}, id = key('ui')) {
  await ready();
  if (destroyed) throw new Error('页面已关闭');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(Object.assign(new Error('等待超时，请继续查看原请求；不要重复提交。'), { code: 'UI_TIMEOUT' })); }, action === 'pick-model' || action === 'pick-project' ? 120000 : 90000);
    pending.set(id, { resolve, reject, timer });
    channel.postMessage({ type: 'ui-request', reqId: id, action, payload });
  });
}
channel.addEventListener('message', event => {
  const value = event.data;
  if (value?.type === 'ui-ready') { readyResolve?.(); return; }
  if (value?.type !== 'ui-response') return;
  const item = pending.get(value.reqId);
  if (!item) return;
  pending.delete(value.reqId); clearTimeout(item.timer);
  if (value.ok) item.resolve(value.data);
  else item.reject(Object.assign(new Error(value.error?.message || '操作失败，请保留当前输入。'), { code: value.error?.code }));
});
function renderModels() {
  const entries = new Map();
  for (const item of catalog) entries.set(modelKey(item.route), item);
  catalog = [...entries.values()];
  $('#model').replaceChildren(new Option('请选择模型', ''));
  for (const item of catalog) $('#model').append(new Option((item.name || item.route.model) + ' · ' + (item.providerName || item.route.providerId) + ' · ' + item.route.agentKind, modelKey(item.route)));
  $('#model').value = saved.route ? modelKey(saved.route) : '';
  renderEfforts(saved.route);
  $('#savedModelLabel').textContent = saved.route ? ($('#model').value ? saved.route.model + ' · ' + saved.route.providerId : '已保存模型当前不可用，请重新选择') : '尚未选择';
  $('#modelSettings').open = !saved.route || !$('#model').value;
  controls();
}
function renderEfforts(initial) {
  const item = catalog.find(entry => modelKey(entry.route) === $('#model').value);
  $('#effort').replaceChildren(new Option('未指定', ''));
  const values = item?.efforts || [];
  for (const value of values) $('#effort').append(new Option(value, value));
  const effort = initial?.effort ?? item?.route.effort ?? '';
  if (effort && !values.includes(effort)) $('#effort').append(new Option(effort, effort));
  $('#effort').value = effort;
  $('#fastMode').replaceChildren(new Option('关闭', 'false'));
  if (item?.supportsFastMode) $('#fastMode').append(new Option('开启', 'true'));
  if (initial?.fastMode === 'ultrafast') $('#fastMode').append(new Option('Ultra Fast（已保存）', 'ultrafast'));
  $('#fastMode').value = String(initial?.fastMode ?? false);
  $('#fastMode').disabled = !item?.supportsFastMode && !initial?.fastMode;
  controls();
}
async function persist(route) {
  const data = await request('save-settings', { route, category: $('#category').value, length: $('#length').value, expectedRevision: saved.revision });
  saved = data.settings;
  $('#savedModelLabel').textContent = saved.route.model + ' · ' + saved.route.providerId;
  controls();
}
let preferenceSave = Promise.resolve();
function queuePreferences() {
  preferenceSave = preferenceSave.catch(() => {}).then(async () => {
    if (!saved.route || modelDirty()) return;
    if (saved.category !== $('#category').value || saved.length !== $('#length').value) await persist(saved.route);
  });
  return preferenceSave;
}
async function saveModel() {
  const value = candidateRoute();
  if (!value) { $('#model').focus(); setStatus('请先选择一个模型。', 'error'); return; }
  $('#saveModelBtn').disabled = true;
  try { await persist(value); setStatus('模型已保存。聊天和工作台均使用 ' + saved.route.model + '。'); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { $('#saveModelBtn').disabled = false; controls(); }
}
function display(value) {
  result = value;
  $('#emptyState').hidden = true; $('#optimizedPrompt').hidden = false;
  $('#optimizedPrompt').textContent = value.optimized_prompt;
  $('#copyBtn').disabled = false;
  const model = value.selected_model;
  const meta = [model ? model.model + ' · 宿主配置已核对' : '历史记录', value.category ? '使用分类：' + value.category : '使用分类未确定', '自动识别：' + (value.detected_category || '未确定') + ' · ' + (value.category_confidence || '未记录') + '置信度（模型自评）', value.length || ''];
  if (value.project_name) meta.unshift('项目：' + value.project_name);
  if (value.history_status) meta.push(value.history_query_verified && value.history_status==='read' ? '已查询项目会话 · 回执已核对' : ({read:'模型报告已参考项目会话',queried:'项目会话查询成功 · 回执已核对',empty:'项目暂无相关会话',unavailable:'项目会话未读取，已用项目资料优化'})[value.history_status]);
  if (value.project_context?.pdf?.pages) meta.push('PDF 已提取 ' + value.project_context.pdf.pages + ' 页，参考 ' + (value.project_context.pdf.includedPages || 0) + ' 页');
  const pdfNotes={PDF_NEEDS_OCR:'扫描/无文本 PDF 需要 OCR',PDF_PASSWORD_REQUIRED:'加密 PDF 需先解锁',PDF_INVALID:'有 PDF 无法解析',PDF_TOO_LARGE:'有 PDF 超过大小限制',PDF_TRUNCATED:'长 PDF 已按预算截取',PDF_PARTIAL_TEXT:'部分 PDF 页面无文本'};
  for(const code of new Set((value.project_context?.pdf?.warnings || []).map(item=>item.code))) meta.push(pdfNotes[code] || '部分 PDF 未读取');
  if (value.project_context?.incomplete) meta.push('项目资料按相关性筛选');
  if (value.category_conflict) meta.push('自动识别不同，已按手动分类处理');
  $('#resultMeta').replaceChildren(...meta.filter(Boolean).map(text => { const span = document.createElement('span'); span.textContent = text; return span; }));
}
async function observe(id) {
  if (polling || destroyed) return;
  polling = true; controls();
  let reconcilingSince = 0;
  try {
    while (!destroyed && activeId === id) {
      const state = await request('query', { request_id: id });
      if (state.status === 'completed') {
        display(state.result); remember(null);
        setStatus(state.result.record_warning ? '优化完成，历史保存失败：' + state.result.record_warning : '优化完成。可直接复制下方提示词。');

        break;
      }
      if (['failed', 'cancelled', 'interrupted'].includes(state.status)) { remember(null); setStatus(state.error?.message || '本次优化已停止。', state.status === 'cancelled' ? 'idle' : 'error'); break; }
      if (state.status === 'reconciling') { reconcilingSince ||= Date.now(); } else reconcilingSince = 0;
      if (state.status === 'uncertain' || (state.status === 'reconciling' && Date.now() - reconcilingSince > 20000)) { setStatus(state.error?.message || '任务状态尚未确定，请继续查看原请求。', 'error'); break; }
      setStatus(({ prepared: '请求已保存，准备调用所选模型…', creating: '正在创建优化任务…', queued: '所选模型任务已排队…', running: '所选模型正在优化…', stopping: '正在取消本次请求…', output_pending: '任务已完成，正在读取对应结果…' })[state.status] || '正在查看原请求…', 'busy');
      await new Promise(resolve => setTimeout(resolve, 2200));
    }
  } catch (error) { if (!destroyed) setStatus(error.message, 'error'); }
  finally { polling = false; controls(); }
}
async function optimize() {
  if (starting || activeId) return;
  if (!selectedProject) { $('#pickProjectBtn').focus(); setStatus('请先选择项目。', 'error'); return; }
  if (!$('#draftPrompt').value.trim()) { $('#draftPrompt').focus(); setStatus('请先输入原始提示词。', 'error'); return; }
  if (!saved.route || modelDirty()) { $('#modelSettings').open = true; $('#model').focus(); setStatus(saved.route ? '模型选择尚未保存，请先保存。' : '请先选择并保存优化模型。', 'error'); return; }
  starting = true; controls();
  try {
    await queuePreferences();
    const id = key('opt');
    const payload = { draft_prompt: $('#draftPrompt').value, category: $('#category').value, length: $('#length').value, settings_revision: saved.revision };
    remember(id); setStatus('正在准备本次优化…', 'busy');
    try { await request('start', payload, id); }
    catch (error) {
      if (error.code !== 'UI_TIMEOUT') remember(null);
      throw error;
    }
    void observe(id);
  } catch (error) { setStatus(error.message, 'error'); }
  finally { starting = false; controls(); }
}
$('#optimizeBtn').addEventListener('click', optimize);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void optimize(); } });
$('#saveModelBtn').addEventListener('click', saveModel);
$('#model').addEventListener('change', () => { renderEfforts(); setStatus('已选择型号，请点击“保存模型”后使用。'); controls(); });
$('#effort').addEventListener('change', controls); $('#fastMode').addEventListener('change', controls);
$('#category').addEventListener('change', () => { void queuePreferences().catch(error => setStatus(error.message, 'error')); });
$('#length').addEventListener('change', () => { void queuePreferences().catch(error => setStatus(error.message, 'error')); });
$('#pickModelBtn').addEventListener('click', async () => { try { const data = await request('pick-model'); saved = data.settings; renderModels(); setStatus('模型已保存。'); } catch (error) { setStatus(error.message, 'error'); } });
$('#refreshModelsBtn').addEventListener('click', async () => { try { const data = await request('bootstrap'); saved = data.settings; catalog = data.models; renderModels(); setStatus('模型目录已刷新。'); } catch (error) { setStatus(error.message, 'error'); } });
$('#resumeBtn').addEventListener('click', () => { if (activeId) void observe(activeId); });
$('#cancelBtn').addEventListener('click', async () => { if (!activeId) return; $('#cancelBtn').disabled = true; try { const state = await request('cancel', { request_id: activeId }); if (['completed', 'cancelled', 'failed', 'interrupted'].includes(state.status)) { if (state.result) display(state.result); remember(null); setStatus('本次请求已停止。'); } else setStatus('正在取消，请保留页面查看最终状态…', 'busy'); } catch (error) { setStatus(error.message, 'error'); } finally { $('#cancelBtn').disabled = false; controls(); } });
$('#copyBtn').addEventListener('click', async () => { if (!result) return; try { await navigator.clipboard.writeText(result.optimized_prompt); setStatus('已复制成品提示词。'); } catch (_) { $('#optimizedPrompt').focus(); const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents($('#optimizedPrompt')); selection.removeAllRanges(); selection.addRange(range); setStatus('请按 Ctrl / ⌘ + C 复制已选中的成品。'); } });
$('#pickProjectBtn').addEventListener('click', async () => { try { const data = await request('pick-project'); selectedProject = data.project; $('#projectStatus').textContent = selectedProject.name; setStatus('项目已选择；开始优化时自动查找相关资料和会话。'); controls(); } catch (error) { setStatus(error.message, 'error'); } });
window.addEventListener('pagehide', () => { destroyed = true; channel.close(); for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('页面已关闭')); } pending.clear(); });
async function init() {
  try { activeId = localStorage.getItem(storageKey); } catch (_) {}
  try {
    const data = await request('bootstrap'); saved = data.settings; catalog = data.models;
    $('#category').value = saved.category || 'auto'; $('#length').value = saved.length || 'auto';
    renderModels();
    selectedProject = data.project || null;
    if (selectedProject) $('#projectStatus').textContent = selectedProject.name;
    setStatus(!selectedProject ? '选择项目后，输入原话即可优化。' : saved.route ? '已就绪，使用模型：' + saved.route.model + '。' : '先选择并保存优化模型。');
    try { activeId = localStorage.getItem(storageKey); } catch (_) {}
    if (activeId) { setStatus('正在恢复查看原请求…', 'busy'); void observe(activeId); }
  } catch (error) { setStatus(error.message, 'error'); }
  controls();
}
void init();