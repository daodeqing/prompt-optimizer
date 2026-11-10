const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const fingerprint = require('./fingerprint.cjs');
const variants = {
  original: '不使用任何工具，也不要创建或修改文件，直接在回复中完成以下任务：创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画，不要使用外部资产。在一个 html 代码块中给出完整 HTML 文件。',
  'all-in-one': '不使用任何工具，也不要创建或修改文件，直接在回复中完成以下任务：做一张精细 SVG 图片：鹈鹕骑自行车在孙悟空驾驶的大型飞机机翼上，翅膀托着秦始皇骑的北极熊，秦始皇在打螺丝。鹈鹕喊出下面糖果题的结果数值：黑袋中圆形苹果、桃子、西瓜糖分别有 7、9、8 颗，五角星形分别有 7、6、4 颗，不同形状靠手感可分辨。活动前决定摸出数目，最少多少颗保证同时有不同形状的苹果味和桃子味糖？圆苹果配星桃或圆桃配星苹果均满足。在一个 svg 代码块中给出完整 SVG 文件。'
};
function prepare(params) {
  if (params.kind === 'pelican' && Object.hasOwn(variants, params.variant)) return { prompts: [{ prompt: variants[params.variant] }] };
  if (params.kind === 'fingerprint') {
    const suite = JSON.parse(fs.readFileSync(path.join(__dirname, '../vendor/lm-detector/enrollment-suite.json'), 'utf8'));
    const entries = [...suite];
    for (let index = entries.length - 1; index > 0; index--) { const other = crypto.randomInt(index + 1); [entries[index], entries[other]] = [entries[other], entries[index]]; }
    return { prompts: entries.slice(0, 3).map(entry => ({ prompt: '不使用工具，不读取文件，不创建子任务。直接回答以下挑战。\n' + (entry.system ? '本题指令：' + entry.system + '\n\n' : '') + (entry.user_prefix ? entry.user_prefix + '\n\nFinal task:\n' : '') + entry.prompt, expected_count: entry.expected_count })), note: 'Cindy 任务带有系统上下文，原题 system 指令在本次作为用户题面发送；与上游采样条件不同，归因概率只供参考。' };
  }
  throw new Error('未知测试类型或版本');
}
function score(params) {
  if (typeof params.text !== 'string' || params.text.length > 262144) throw new Error('测试回答为空或超过 256K 字符');
  if (params.kind === 'fingerprint') { const numbers = fingerprint.parseNumbers(params.text).slice(0, params.expected_count); const minimum = Math.max(80, Math.ceil(params.expected_count * 0.55)); return { status: numbers.length >= minimum ? 'collected' : 'ungraded', parsed_numbers: numbers.length, expected_count: params.expected_count, raw_answer: numbers.join(', '), reason: numbers.length >= minimum ? '数字样本已采集，完成后统一归因' : '有效数字不足，无法用于归因' }; }
  if (params.kind === 'pelican') {
    const language = params.variant === 'all-in-one' ? 'svg' : 'html';
    const blocks = [...params.text.matchAll(/```([\w-]*)[^\n]*\n([\s\S]*?)```/g)];
    const preferred = blocks.find(block => block[1].toLowerCase() === language) || blocks.find(block => block[2].trim().startsWith('<'));
    const code = (preferred ? preferred[2] : params.text).trim();
    if (!/<svg(?:\s|>)/i.test(code)) return { status: 'ungraded', raw_answer: params.text.slice(0, 8000), reason: '没有找到 SVG 画面' };
    return { status: 'generated', markup: code, language, raw_answer: code, reason: '画面已生成，请人工比较构图、完整性与指令遵循；不自动判定降智。' };
  }
  throw new Error('未知评分类型');
}
module.exports = { prepare, score, analyze: fingerprint.analyze };
