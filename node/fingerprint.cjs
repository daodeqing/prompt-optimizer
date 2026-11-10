const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const directory = path.join(__dirname, '../vendor/lm-detector');
let cached;
const dot = (left, right) => left.reduce((total, value, index) => total + value * right[index], 0);
const mean = values => values.reduce((total, value) => total + value, 0) / values.length;
const median = values => { const sorted = [...values].sort((left, right) => left - right); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const unit = values => { const scale = Math.max(Math.sqrt(dot(values, values)), 1e-12); return values.map(value => value / scale); };
const zscores = values => { const center = mean(values); const scale = Math.max(Math.sqrt(mean(values.map(value => (value - center) ** 2))), 1e-12); return values.map(value => (value - center) / scale); };
const standardize = (values, center, scale) => values.map((value, index) => (value - center[index]) / scale[index]);
const rootShares = values => { const total = values.reduce((sum, value) => sum + value, 0); return values.map(value => Math.sqrt(value / total)); };
const columnMean = rows => rows[0].map((_, index) => mean(rows.map(row => row[index])));
function subtractBasis(values, basis) { const coefficients = basis.map(row => dot(values, row)); return values.map((value, index) => value - basis.reduce((total, row, rowIndex) => total + coefficients[rowIndex] * row[index], 0)); }
function detector() {
  if (cached) return cached;
  const file = fs.readFileSync(path.join(directory, 'shared_detector.bin'));
  const end = 4 + file.readUInt32LE(0), start = Math.ceil(end / 4) * 4, count = (file.length - start) / 4;
  if (!Number.isSafeInteger(count) || count < 1) throw new Error('指纹参考库格式无效');
  const floats = new Float32Array(count), bytes = Buffer.alloc(4);
  for (let index = 0; index < count; index++) { for (let plane = 0; plane < 4; plane++) bytes[plane] = file[start + plane * count + index]; floats[index] = bytes.readFloatLE(0); }
  const data = JSON.parse(file.subarray(4, end).toString('utf8'), (_, value) => {
    if (value && typeof value === 'object' && '$f32' in value) { if (!Number.isSafeInteger(value.$f32) || !Number.isSafeInteger(value.n) || value.$f32 < 0 || value.n < 0 || value.$f32 + value.n > count) throw new Error('指纹库向量越界'); return Array.from(floats.subarray(value.$f32, value.$f32 + value.n)); }
    return value;
  });
  const bank = JSON.parse(fs.readFileSync(path.join(directory, 'models.json'), 'utf8'));
  const calibration = data.calibration;
  if (data.schema !== 'shared-detector-v2' || calibration.schema !== 'shared-confidence-v2' || calibration.method !== 'ranking-temperature' || !(calibration.tau >= 0.001 && calibration.tau <= 1000) || bank.built_at !== data.bank_built_at || JSON.stringify(bank.models.map(model => model.id)) !== JSON.stringify(data.model_ids) || bank.models.some((model, index) => model.response_count !== data.response_counts[index]) || calibration.binding.base_sha256 !== data.base_sha256 || calibration.binding.reference_sha256 !== data.source_reference_sha256 || JSON.stringify(calibration.binding.model_ids) !== JSON.stringify(data.model_ids)) throw new Error('指纹参考库与校准数据不匹配');
  data.models = bank.models; data.revision = 'sha256:' + crypto.createHash('sha256').update(file).digest('hex');
  data.referenceNorms = data.ranker.references.map(rows => rows.map(row => dot(row, row)));
  cached = data; return data;
}
function parseNumbers(text) {
  let best = [], current = [], end = 0;
  for (const match of String(text).matchAll(/[0-9]+/g)) {
    if (/\p{L}/u.test(text.slice(end, match.index))) { if (current.length > best.length) best = current; current = []; }
    const value = Number(match[0]); if (Number.isSafeInteger(value) && value >= 1 && value <= 355) current.push(value);
    end = match.index + match[0].length;
  }
  return current.length > best.length ? current : best;
}
function hellinger(numbers) { const counts = Array(355).fill(0.5); for (const value of numbers) counts[value - 1]++; return rootShares(counts); }
function ordered(numbers) {
  const output = []; let start = 0;
  for (let block = 0; block < 4; block++) { const size = Math.floor(numbers.length / 4) + (block < numbers.length % 4 ? 1 : 0), bins = Array(16).fill(0.5); for (const value of numbers.slice(start, start + size)) bins[Math.min(15, Math.floor((value - 1) / 355 * 16))]++; output.push(...rootShares(bins)); start += size; }
  const digits = Array(10).fill(0.5); for (const value of numbers) digits[value % 10]++; return output.concat(rootShares(digits));
}
function positionKernel(numbers) {
  const output = Array(102).fill(0);
  numbers.forEach((value, position) => { const relative = (position + 0.5) * 2 / numbers.length - 1; const basis = [relative, 0.5 * (3 * relative ** 2 - 1), 0.5 * (5 * relative ** 3 - 3 * relative)]; for (let bin = 0; bin < 34; bin++) { const weight = bin < 24 ? Math.exp(-0.5 * ((value - (1 + bin * 354 / 23)) / 20) ** 2) : Number(bin - 24 === value % 10); basis.forEach((factor, index) => { output[bin * 3 + index] += weight * factor / numbers.length; }); } });
  return output;
}
function transitions(symbols, bins) {
  const joint = Array(bins * bins).fill(0.5); for (let index = 1; index < symbols.length; index++) joint[symbols[index - 1] * bins + symbols[index]]++;
  const total = symbols.length - 1 + 0.5 * bins * bins, rows = Array(bins).fill(0), columns = Array(bins).fill(0);
  joint.forEach((value, index) => { joint[index] = value / total; rows[Math.floor(index / bins)] += joint[index]; columns[index % bins] += joint[index]; });
  return joint.map((value, index) => value - rows[Math.floor(index / bins)] * columns[index % bins]);
}
function sequenceFeatures(numbers) {
  const length = numbers.length, center = mean(numbers), scale = Math.max(Math.sqrt(mean(numbers.map(value => (value - center) ** 2))), 1), standardized = numbers.map(value => (value - center) / scale), output = [];
  const fraction = (count, test) => { let hits = 0; for (let index = 0; index < count; index++) if (test(index)) hits++; return hits / count; };
  for (const lag of [1, 2, 3, 5, 8, 13, 21, 34]) { const count = length - lag, step = index => numbers[index + lag] - numbers[index]; let correlation = 0, distance = 0; for (let index = 0; index < count; index++) { correlation += standardized[index + lag] * standardized[index]; distance += Math.abs(step(index)); } output.push(correlation / count, distance / count / 355, fraction(count, index => step(index) > 0), fraction(count, index => step(index) === 0), fraction(count, index => Math.abs(step(index)) <= 5), fraction(count, index => Math.abs(step(index)) <= 20)); }
  output.push(...transitions(numbers.map(value => Math.min(7, Math.floor((value - 1) * 8 / 355))), 8), ...transitions(numbers.map(value => value % 10), 10));
  const step = index => numbers[index + 1] - numbers[index];
  output.push(fraction(length - 2, index => Math.sign(step(index + 1)) === Math.sign(step(index))), fraction(length - 2, index => step(index + 1) === step(index)), fraction(length - 1, index => numbers[index] % 10 === numbers[index + 1] % 10), fraction(length - 1, index => Math.abs(standardized[index + 1] - standardized[index]) > 1), fraction(length - 1, index => Math.abs(standardized[index + 1] - standardized[index]) > 2));
  for (const width of [4, 8, 16]) { let coverage = 0; for (let index = 0; index + width <= length; index++) coverage += new Set(numbers.slice(index, index + width).map(value => Math.min(15, Math.floor((value - 1) * 16 / 355)))).size / width; output.push(coverage / (length - width + 1)); }
  return output;
}
function joinBlocks(blocks, params, shares) { return blocks.flatMap((block, index) => unit(standardize(block, params[index].mean, params[index].scale)).map(value => value * Math.sqrt(shares[index]))); }
function baseline(numbers, ranker) {
  const marginalBank = ranker.bank.hellinger, orderedBank = ranker.bank.ordered_blocks;
  const marginalUnit = unit(subtractBasis(standardize(hellinger(numbers), marginalBank.feature_mean, marginalBank.feature_scale), marginalBank.nuisance_basis));
  const marginal = marginalBank.centroids.map(row => dot(marginalUnit, row));
  const centered = standardize(ordered(numbers), orderedBank.feature_mean, orderedBank.feature_scale), raw = unit(centered), projected = unit(subtractBasis(centered, orderedBank.nuisance_basis));
  const templates = zscores(orderedBank.centroids.map((_, index) => Math.max(...orderedBank.environment_centroids.map(environment => dot(raw, environment[index]))))), nuisance = zscores(orderedBank.centroids.map(row => dot(projected, row)));
  const sequential = zscores(templates.map((value, index) => 0.5 * value + 0.5 * nuisance[index]));
  return zscores(marginal).map((value, index) => 0.5 * value + 0.5 * sequential[index]);
}
function rank(answers, data) {
  const ranker = data.ranker, full = [], linear = [], base = [], positional = [];
  for (const numbers of answers) {
    full.push(joinBlocks([hellinger(numbers), ordered(numbers)], ranker.full_params, [0.75, 0.25]));
    const head = numbers.slice(0, 128), features = joinBlocks([hellinger(head), ordered(head)], ranker.head_params, [0.75, 0.25]);
    linear.push(zscores(ranker.lda_weights.map((row, index) => dot(row, features) + ranker.lda_bias[index]))); base.push(baseline(numbers, ranker));
    const sequential = joinBlocks([hellinger(numbers), ordered(numbers), positionKernel(numbers), sequenceFeatures(numbers)], ranker.positional.params, [0.6, 0.15, 0.125, 0.125]);
    positional.push(zscores(ranker.positional.weights.map((row, index) => dot(row, sequential) + ranker.positional.bias[index])));
  }
  const near = zscores(ranker.references.map((references, modelIndex) => median(full.map(features => { const norm = dot(features, features); return -mean(references.map((row, index) => Math.max(0, norm + data.referenceNorms[modelIndex][index] - 2 * dot(features, row))).sort((left, right) => left - right).slice(0, 7)); }))));
  const linearMean = zscores(columnMean(linear)), baseMean = zscores(columnMean(base));
  const frequency = zscores(linearMean.map((value, index) => 0.5 * value + 0.25 * near[index] + 0.25 * baseMean[index])), sequential = zscores(columnMean(positional));
  return frequency.map((value, index) => ranker.blend.frequency * value + ranker.blend.positional * sequential[index]);
}
function analyze(outputs) {
  if (!Array.isArray(outputs) || outputs.length > 3 || outputs.some(output => typeof output.text !== 'string' || output.text.length > 64000 || !Number.isSafeInteger(output.expected_count) || output.expected_count < 80 || output.expected_count > 2000)) throw new Error('指纹输入无效');
  const diagnostics = [], accepted = [];
  outputs.forEach((output, index) => { const numbers = parseNumbers(output.text), minimum = Math.max(80, Math.ceil(output.expected_count * 0.55)), valid = numbers.length >= minimum; diagnostics.push({ index, parsed_numbers: numbers.length, minimum_numbers: minimum, accepted: valid }); if (valid) accepted.push(numbers); });
  if (!accepted.length) throw new Error('未采集到有效数字序列');
  const data = detector();
  const autocorrelations = [], smallSteps = [];
  for (const numbers of accepted) { const center = mean(numbers), variance = mean(numbers.map(value => (value - center) ** 2)); let lagged = 0, small = 0; for (let index = 1; index < numbers.length; index++) { lagged += (numbers[index] - center) * (numbers[index - 1] - center); if (Math.abs(numbers[index] - numbers[index - 1]) <= 20) small++; } autocorrelations.push(variance ? lagged / (numbers.length - 1) / variance : 1); smallSteps.push(small / (numbers.length - 1)); }
  const sequence = { autocorrelation: median(autocorrelations), small_step_share: median(smallSteps) }; sequence.model_like = sequence.autocorrelation <= -0.23 || sequence.small_step_share <= 0.05;
  const result = { detector_revision: data.revision, used_outputs: accepted.length, diagnostics, sequence, probability: null, results: [] };
  if (!sequence.model_like) return { ...result, decision: 'not_model', prediction: '' };
  const ranking = rank(accepted, data), maximum = Math.max(...ranking.map(value => data.calibration.tau * value)), weights = ranking.map(value => Math.exp(data.calibration.tau * value - maximum)), total = weights.reduce((sum, value) => sum + value, 0);
  result.results = ranking.map((score, index) => ({ model: data.models[index].id, display_name: data.models[index].display_name, family: data.models[index].family, family_name: data.models[index].family_name, score, probability: accepted.length === 3 ? weights[index] / total : null })).sort((left, right) => right.score - left.score);
  const top = result.results[0]; return { ...result, decision: accepted.length === 3 ? 'ranked' : 'partial', prediction: top.model, prediction_name: top.display_name, probability: top.probability, family_prediction_name: top.family_name };
}
module.exports = { analyze, parseNumbers };
