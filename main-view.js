const channel = new BroadcastChannel('prompt-optimizer');
const $ = selector => document.querySelector(selector);
const pending = new Map();
let saved = { revision: 0, route: null, category: 'auto', length: 'auto' };
let candyRunning = false;
let testKind = 'candy', activeTestId = null;
const testStorageKey = 'prompt-optimizer-test-active-v1';
const testDescriptions = {
  candy: '糖果题：独立闭卷推理，按最终整数答案 21 评分。答错或单次低通过率都不能证明账号降智。',
  fingerprint: '指纹检测：随机采集 3 组数字挑战，与 LM Detector 参考库比较候选模型与家族。结果是统计归因，不是身份验证；Cindy 的系统上下文与参考采样条件不同。',
  pelican: '画鹈鹕：让所选模型用 SVG 绘制骑自行车的鹈鹕，原版输出动画 HTML，多合一版加入复杂构图与糖果题。画面质量由你判断，不自动打分。',
  siwc: '此通道暂不支持 SIWC 检测。参考项目依赖 CPA 的 SIWC 绑定和逐凭证请求，Cindy 模型目录不暴露这些凭证状态。普通模型请求成功无法证明 SIWC 可用。'
};
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
  $('#optimizeBtn').disabled = candyRunning || !!activeTestId || starting || !!activeId || !selectedProject || !saved.route || !candidateRoute() || modelDirty();
  $('#candyBtn').disabled = testKind === 'siwc' || candyRunning || !!activeTestId || starting || !!activeId || !saved.route || !candidateRoute() || modelDirty();
  $('#cancelTestBtn').hidden = !activeTestId;
  $('#resumeTestBtn').hidden = !activeTestId || candyRunning;
  $('#testModel').disabled = candyRunning || !!activeTestId;
  $('#testEffort').disabled = candyRunning || !!activeTestId || !catalog.find(item => modelKey(item.route) === $('#testModel').value)?.efforts?.length;
  $('#saveTestModel').disabled = candyRunning || !!activeTestId || !$('#testModel').value;
  document.querySelectorAll('[data-test]').forEach(button => { button.disabled = candyRunning || !!activeTestId; });
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
  if (value?.type === 'settings-changed' && !starting && !candyRunning && !activeTestId) {
    void request('bootstrap').then(data => { saved = data.settings; catalog = data.models; renderModels(); }).catch(error => setStatus(error.message, 'error')); return;
  }
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
  syncTestModels();
  $('#savedModelLabel').textContent = saved.route ? ($('#model').value ? saved.route.model + ' · ' + saved.route.providerId : '已保存模型当前不可用，请重新选择') : '尚未选择';
  $('#modelSettings').open = true;
  controls();
}
function renderEfforts(initial) {
  const item = catalog.find(entry => modelKey(entry.route) === $('#model').value);
  $('#effort').replaceChildren(new Option('未指定', ''));
  const values = item?.efforts || [];
  for (const value of values) $('#effort').append(new Option(value, value));
  const effort = initial?.effort ?? item?.route.effort ?? '';
  $('#effort').value = values.includes(effort) ? effort : '';
  $('#effort').disabled = !values.length;
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
  syncTestModels();
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
function syncTestModels() {
  $('#testModel').replaceChildren(new Option('请选择模型', ''));
  for (const item of catalog) $('#testModel').append(new Option((item.name || item.route.model) + ' · ' + item.providerName + ' · ' + item.route.agentKind, modelKey(item.route)));
  $('#testModel').value = $('#model').value; syncTestEfforts();
}
function syncTestEfforts() {
  const item = catalog.find(entry => modelKey(entry.route) === $('#testModel').value);
  $('#testEffort').replaceChildren(new Option('未指定', ''));
  for (const effort of item?.efforts || []) $('#testEffort').append(new Option(effort, effort));
  $('#testEffort').value = $('#effort').value; controls();
}
function rememberTest(id) { activeTestId = id; try { if (id) localStorage.setItem(testStorageKey, id); else localStorage.removeItem(testStorageKey); } catch (_) {} controls(); }
function switchTest(kind) {
  testKind = kind;
  document.querySelectorAll('[data-test]').forEach(button => { const active = button.dataset.test === kind; button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1; });
  $('#testContent').setAttribute('aria-labelledby', 'tab-' + kind);
  $('#testDescription').textContent = testDescriptions[kind]; $('#testConfiguration').hidden = kind === 'siwc';
  $('#runsField').hidden = kind !== 'candy'; $('#variantField').hidden = kind !== 'pelican';
  $('#testPrompt').textContent = '展开后读取题目。'; $('#testPromptDetails').open = false;
  $('#testStatus').textContent = kind === 'siwc' ? '当前接口无法核验 SIWC。' : '使用已保存模型，每次测试按实际调用计费。';
  $('#candyResult').hidden = true; $('#candyEmpty').hidden = kind === 'siwc'; controls();
}
function textElement(tag, text, className) { const node = document.createElement(tag); node.textContent = text; if (className) node.className = className; return node; }
function previewDocument(markup) {
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,link,meta,base,form,foreignObject,foreignobject').forEach(node => node.remove());
  for (const node of parsed.querySelectorAll('*')) for (const attribute of [...node.attributes]) if (/^on/i.test(attribute.name) || ['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction', 'target'].includes(attribute.name.toLowerCase()) && !attribute.value.startsWith('#')) node.removeAttribute(attribute.name);
  const policy = document.createElement('meta'); policy.httpEquiv = 'Content-Security-Policy'; policy.content = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'"; parsed.head.prepend(policy);
  return '<!doctype html>' + parsed.documentElement.outerHTML;
}
function renderCandy(value) {
  $('#candyEmpty').hidden = true; $('#candyResult').hidden = false; $('#candyResult').replaceChildren();
  const model = value.selected_model;
  $('#candyResult').append(textElement('p', model.model + ' · ' + model.providerId + ' · 推理 ' + (model.effort || '默认'), 'test-meta'));
  if (value.test === 'candy') $('#candyResult').append(textElement('p', '通过 ' + value.correct + '/' + value.graded + '；通过率 ' + (value.pass_rate === null ? '暂无' : value.pass_rate + '%') + '。完成 ' + value.finished_runs + '/' + value.requested_runs + '；无法评分 ' + value.ungraded + '；请求失败 ' + value.failed));
  if (value.attribution) {
    const attribution = value.attribution;
    const headline = attribution.decision === 'not_model' ? '数字序列不符合参考库统计形态，未归因。' : '最接近：' + attribution.prediction_name + ' · ' + attribution.family_prediction_name + (attribution.probability === null ? '（样本不全，不给概率）' : ' · 候选归因概率 ' + (100 * attribution.probability).toFixed(1) + '%');
    $('#candyResult').append(textElement('p', headline));
    for (const candidate of attribution.results.slice(0, 5)) $('#candyResult').append(textElement('p', candidate.display_name + ' · ' + (candidate.probability === null ? '分数 ' + candidate.score.toFixed(3) : (100 * candidate.probability).toFixed(1) + '%'), 'hint'));
  }
  if (value.error) $('#candyResult').append(textElement('p', value.error.message || '部分结果未能解析，请查看原始回答。'));
  const names = { correct: '通过', wrong: '未通过', failed: '请求失败', ungraded: '无法评分', generated: '已生成画面', collected: '已采集样本' };
  for (const item of value.results) {
    const section = document.createElement('details'); section.className = 'test-round';
    section.append(textElement('summary', '第 ' + item.round + ' 次 · ' + (names[item.status] || item.status) + (item.duration_ms === undefined ? '' : ' · ' + (item.duration_ms / 1000).toFixed(1) + ' 秒')));
    if (item.final_answer !== undefined) section.append(textElement('p', '最终答案：' + item.final_answer));
    section.append(textElement('p', item.reason || item.error || ''));
    section.append(textElement('pre', item.raw_answer || '', 'test-text'));
    if (item.markup) {
      const frame = document.createElement('iframe'); frame.title = '鹈鹕画面预览（禁用脚本和外部资源）'; frame.setAttribute('sandbox', ''); frame.referrerPolicy = 'no-referrer'; frame.srcdoc = previewDocument(item.markup); frame.className = 'test-preview'; section.prepend(frame); section.open = true;
      const copy = textElement('button', '复制原始代码'); copy.type = 'button'; copy.addEventListener('click', () => { void navigator.clipboard.writeText(item.markup).then(() => { $('#testStatus').textContent = '已复制代码。'; }).catch(() => { $('#testStatus').textContent = '复制失败，请手动选择原始代码复制。'; }); }); section.append(copy);
    }
    $('#candyResult').append(section);
  }
  $('#candyResult').append(textElement('p', value.note, 'hint'));
}
async function refreshTestHistory() {
  const data = await request('test-history'); $('#testHistory').replaceChildren();
  if (!data.history.length) { $('#testHistory').textContent = '暂无记录。'; return; }
  for (const value of data.history) {
    const button = textElement('button', ({ candy: '糖果题', pelican: '画鹈鹕', fingerprint: '指纹检测' }[value.test] || value.test) + ' · ' + value.selected_model.model + ' · ' + (value.selected_model.effort || '默认') + ' · ' + new Date(value.created_at).toLocaleString() + ' · ' + value.status, 'history-item'); button.type = 'button';
    button.addEventListener('click', async () => { if (activeTestId || candyRunning) return; try { const state = await request('test-load', { request_id: value.request_id }); switchTest(state.test); renderCandy(state); if (!['completed', 'cancelled', 'failed', 'interrupted'].includes(state.status)) { rememberTest(state.request_id); $('#testStatus').textContent = '已载入原请求，请点击“继续查看”。'; } } catch (error) { $('#testStatus').textContent = error.message; } }); $('#testHistory').append(button);
  }
}
async function observeTest(id) {
  if (candyRunning || destroyed) return;
  candyRunning = true; controls();
  try {
    while (!destroyed && activeTestId === id) {
      const state = await request('test-query', { request_id: id }); renderCandy(state);
      $('#testStatus').textContent = '已完成 ' + state.finished_runs + '/' + state.requested_runs + ' 次。' + (state.error?.message || '');
      if (['completed', 'cancelled', 'failed', 'interrupted'].includes(state.status)) { rememberTest(null); await refreshTestHistory(); break; }
      if (['uncertain', 'reconciling'].includes(state.status)) { $('#testStatus').textContent = state.error?.message || '任务状态尚未确定，请继续查看原请求。'; break; }
      await new Promise(resolve => setTimeout(resolve, 1800));
    }
  } catch (error) { if (!destroyed) $('#testStatus').textContent = error.message; }
  finally { candyRunning = false; controls(); }
}
async function candyTest() {
  if (candyRunning || activeTestId || !saved.route || modelDirty() || testKind === 'siwc') return;
  const id = key('test'); rememberTest(id); candyRunning = true; controls(); $('#testStatus').textContent = '正在保存本次请求…';
  try {
    await request('test-start', { kind: testKind, variant: $('#testVariant').value, runs: Number($('#candyRuns').value), settings_revision: saved.revision }, id);
    candyRunning = false; void observeTest(id);
  } catch (error) { if (error.code !== 'UI_TIMEOUT') rememberTest(null); $('#testStatus').textContent = error.message; candyRunning = false; controls(); }
}
$('#optimizeBtn').addEventListener('click', optimize);
$('#candyBtn').addEventListener('click', candyTest);
document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void optimize(); } });
$('#saveModelBtn').addEventListener('click', saveModel);
$('#model').addEventListener('change', () => { renderEfforts(); syncTestModels(); setStatus('已选择型号，请点击“保存模型”后使用。'); controls(); });
$('#effort').addEventListener('change', () => { syncTestModels(); controls(); }); $('#fastMode').addEventListener('change', controls);
$('#testModel').addEventListener('change', () => { $('#model').value = $('#testModel').value; renderEfforts(); syncTestEfforts(); $('#testStatus').textContent = '选择尚未保存。'; controls(); });
$('#testEffort').addEventListener('change', () => { $('#effort').value = $('#testEffort').value; $('#testStatus').textContent = '强度尚未保存。'; controls(); });
$('#saveTestModel').addEventListener('click', async () => { await saveModel(); $('#testStatus').textContent = modelDirty() ? '模型未保存，请查看页面状态后重试。' : '模型与强度已保存。'; });
$('#resumeTestBtn').addEventListener('click', () => { if (activeTestId) void observeTest(activeTestId); });
$('#cancelTestBtn').addEventListener('click', async () => { if (!activeTestId) return; try { const state = await request('test-cancel', { request_id: activeTestId }); renderCandy(state); if (['completed', 'cancelled', 'failed', 'interrupted'].includes(state.status)) { rememberTest(null); await refreshTestHistory(); } $('#testStatus').textContent = state.status === 'cancelled' ? '测试已取消，已完成结果保留。' : '正在取消原请求，请继续查看。'; } catch (error) { $('#testStatus').textContent = error.message; } });
$('#testRefresh').addEventListener('click', () => { void refreshTestHistory().catch(error => { $('#testStatus').textContent = error.message; }); });
document.querySelectorAll('[data-test]').forEach(button => {
  button.addEventListener('click', () => switchTest(button.dataset.test));
  button.addEventListener('keydown', event => { const buttons = [...document.querySelectorAll('[data-test]')]; const index = buttons.indexOf(button); let next; if (event.key === 'ArrowRight') next = (index + 1) % buttons.length; if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length; if (event.key === 'Home') next = 0; if (event.key === 'End') next = buttons.length - 1; if (next !== undefined && !candyRunning && !activeTestId) { event.preventDefault(); switchTest(buttons[next].dataset.test); buttons[next].focus(); } });
});
$('#testPromptDetails').addEventListener('toggle', () => { if (!$('#testPromptDetails').open) return; const kind = testKind, variant = $('#testVariant').value; void request('test-prompt', { kind, variant }).then(data => { if (kind === testKind && variant === $('#testVariant').value) $('#testPrompt').textContent = data.prompts.map((entry, index) => '题目 ' + (index + 1) + String.fromCharCode(10) + entry.prompt).join(String.fromCharCode(10, 10)); }).catch(error => { $('#testPrompt').textContent = error.message; }); });
$('#testVariant').addEventListener('change', () => { $('#testPromptDetails').open = false; });
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
    switchTest('candy'); await refreshTestHistory();
    selectedProject = data.project || null;
    if (selectedProject) $('#projectStatus').textContent = selectedProject.name;
    setStatus(!selectedProject ? '选择项目后，输入原话即可优化。' : saved.route ? '已就绪，使用模型：' + saved.route.model + '。' : '先选择并保存优化模型。');
    try { activeId = localStorage.getItem(storageKey); } catch (_) {}
    if (activeId) { setStatus('正在恢复查看原请求…', 'busy'); void observe(activeId); }
    try { activeTestId = localStorage.getItem(testStorageKey); } catch (_) {}
    if (activeTestId) {
      try { const state = await request('test-load', { request_id: activeTestId }); switchTest(state.test); renderCandy(state); if (['completed', 'cancelled', 'failed', 'interrupted'].includes(state.status)) rememberTest(null); else $('#testStatus').textContent = '找到未完成的原请求，请点击“继续查看”。'; }
      catch (error) { if (error.code === 'REQUEST_NOT_FOUND') rememberTest(null); $('#testStatus').textContent = error.message; }
    }
  } catch (error) { setStatus(error.message, 'error'); }
  controls();
}
void init();
