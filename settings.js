const settingsChannel = new BroadcastChannel('prompt-optimizer');
const settingsPending = new Map();
const element = id => document.getElementById(id);
let configuration = null, settingsCatalog = [], settingsBusy = false, settingsClosed = false;
let settingsReady = null, completeReady = null;
const routeKey = value => JSON.stringify([value.agentKind, value.providerId, value.model]);
function status(message) { element('settingsStatus').textContent = message; }
async function settingsRequest(action, payload = {}) {
  if (!settingsReady) settingsReady = new Promise((resolve, reject) => {
    const ping = setInterval(() => settingsChannel.postMessage({ type: 'ui-ping' }), 200);
    const timeout = setTimeout(() => { clearInterval(ping); settingsReady = null; reject(new Error('插件未就绪，请刷新设置。')); }, 12000);
    completeReady = () => { clearTimeout(timeout); clearInterval(ping); resolve(); };
    fetch('/wake').then(response => { if (!response.ok) throw new Error('无法唤醒插件，请重新打开设置。'); settingsChannel.postMessage({ type: 'ui-ping' }); }).catch(error => { clearTimeout(timeout); clearInterval(ping); settingsReady = null; reject(error); });
  });
  await settingsReady;
  const requestId = 'settings-' + crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { settingsPending.delete(requestId); reject(new Error('等待超时，请刷新设置后查看是否已保存。')); }, 95000);
    settingsPending.set(requestId, { resolve, reject, timeout });
    settingsChannel.postMessage({ type: 'ui-request', reqId: requestId, action, payload });
  });
}
settingsChannel.addEventListener('message', event => {
  const response = event.data; if (response?.type === 'ui-ready') { completeReady?.(); return; } if (response?.type !== 'ui-response') return; const pending = settingsPending.get(response.reqId); if (!pending) return;
  clearTimeout(pending.timeout); settingsPending.delete(response.reqId);
  if (response.ok) pending.resolve(response.data); else pending.reject(new Error(response.error?.message || '设置未保存，请刷新后重试。'));
});
function efforts(initial) {
  const item = settingsCatalog.find(model => routeKey(model.route) === element('settingsModel').value);
  element('settingsEffort').replaceChildren(new Option('未指定', '')); for (const effort of item?.efforts || []) element('settingsEffort').append(new Option(effort, effort));
  element('settingsEffort').value = initial?.effort ?? item?.route.effort ?? '';
  element('settingsFast').replaceChildren(new Option('关闭', 'false')); if (item?.supportsFastMode) element('settingsFast').append(new Option('开启', 'true'));
  if (initial?.fastMode === 'ultrafast') element('settingsFast').append(new Option('Ultra Fast（已保存）', 'ultrafast'));
  element('settingsFast').value = String(initial?.fastMode ?? false);
  element('settingsEffort').disabled = !item?.efforts?.length; element('settingsFast').disabled = !item?.supportsFastMode;
  element('saveSettings').disabled = !item || settingsBusy;
}
function renderSettings() {
  element('settingsModel').replaceChildren(new Option('请选择模型', ''));
  for (const item of settingsCatalog) element('settingsModel').append(new Option(item.name + ' · ' + item.providerName + ' · ' + item.route.agentKind, routeKey(item.route)));
  element('settingsModel').value = configuration?.route ? routeKey(configuration.route) : ''; efforts(configuration?.route);
}
async function loadSettings() { const data = await settingsRequest('bootstrap'); configuration = data.settings; settingsCatalog = data.models; renderSettings(); status(configuration.route ? '已保存：' + configuration.route.model + ' · 推理 ' + (configuration.route.effort || '默认') : '请选择模型与推理强度。'); }
async function action(callback) {
  if (settingsBusy || settingsClosed) return; settingsBusy = true; for (const button of document.querySelectorAll('button')) button.disabled = true;
  try { await callback(); } catch (error) { status(error.message); } finally { settingsBusy = false; for (const button of document.querySelectorAll('button')) button.disabled = false; element('saveSettings').disabled = !element('settingsModel').value; }
}
element('settingsModel').addEventListener('change', () => { efforts(); status('选择尚未保存。'); });
element('saveSettings').addEventListener('click', () => action(async () => {
  const item = settingsCatalog.find(model => routeKey(model.route) === element('settingsModel').value); if (!item) throw new Error('请先选择模型。');
  const fast = element('settingsFast').value; const route = { ...item.route, effort: element('settingsEffort').value, fastMode: fast === 'ultrafast' ? fast : fast === 'true' };
  const data = await settingsRequest('save-settings', { route, category: configuration.category, length: configuration.length, expectedRevision: configuration.revision });
  configuration = data.settings; renderSettings(); status('已保存。工作台与聊天调用都会使用这份配置。');
}));
element('nativePicker').addEventListener('click', () => action(async () => { const data = await settingsRequest('pick-model'); configuration = data.settings; await loadSettings(); }));
element('reloadSettings').addEventListener('click', () => action(loadSettings));
window.addEventListener('pagehide', () => { settingsClosed = true; settingsChannel.close(); for (const pending of settingsPending.values()) { clearTimeout(pending.timeout); pending.reject(new Error('页面已关闭')); } settingsPending.clear(); });
void action(loadSettings);
