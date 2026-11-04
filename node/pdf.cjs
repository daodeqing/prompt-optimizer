const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs/promises');
const resources = path.join(__dirname,'../vendor/pdfjs');
function resourceName(name) { if(typeof name !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(name) || name.includes('..')) throw new Error('Invalid bundled PDF resource'); return name; }
class LocalCMaps { async fetch({name}) { return { cMapData:new Uint8Array(await fs.readFile(path.join(resources,'cmaps',resourceName(name)+'.bcmap'))), isCompressed:true }; } }
class LocalFonts { async fetch({filename}) { return new Uint8Array(await fs.readFile(path.join(resources,'standard_fonts',resourceName(filename)))); } }
class TextOnlyCanvas { create() { throw new Error('PDF text extraction does not render canvases'); } destroy() {} }
class TextOnlyFilters { destroy() {} }
let modulePromise;
function pdfModule() {
  if (!modulePromise) modulePromise = import(pathToFileURL(path.join(__dirname,'../vendor/pdfjs/legacy/build/pdf.mjs')).href).then(async pdf => {
    globalThis.pdfjsWorker = await import(pathToFileURL(path.join(__dirname,'../vendor/pdfjs/legacy/build/pdf.worker.mjs')).href);
    pdf.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(__dirname,'../vendor/pdfjs/legacy/build/pdf.worker.mjs')).href;
    return pdf;
  });
  return modulePromise;
}
function textLines(items) {
  let result = '';
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const previous = result.slice(-1), next = item.str.slice(0,1);
    if (previous && previous !== '\n' && item.str && !(/[\u3400-\u9fff]/.test(previous) && /[\u3400-\u9fff]/.test(next))) result += ' ';
    result += item.str;
    if (item.hasEOL) result += '\n';
  }
  return result.trim();
}
async function extractPdf(buffer, options={}) {
  if (buffer.length > 12*1024*1024) return { pages:[], warning:'PDF_TOO_LARGE' };
  const pdf = await pdfModule();
  const task = pdf.getDocument({data:new Uint8Array(buffer), useWorkerFetch:false, CMapReaderFactory:LocalCMaps, StandardFontDataFactory:LocalFonts, CanvasFactory:TextOnlyCanvas, FilterFactory:TextOnlyFilters, isOffscreenCanvasSupported:false, isImageDecoderSupported:false, isEvalSupported:false, useWasm:false, disableFontFace:true, useSystemFonts:false,
    cMapUrl:path.join(__dirname,'../vendor/pdfjs/cmaps/'), cMapPacked:true,
    standardFontDataUrl:path.join(__dirname,'../vendor/pdfjs/standard_fonts/'), verbosity:options.verbosity||0});
  let doc;
  try {
    doc = await task.promise;
    const pages=[];let chars=0, blank=0;
    const limit=Math.min(doc.numPages,options.maxPages||80);
    for(let number=1;number<=limit;number++) {
      if(chars>=220000)break;
      const page=await doc.getPage(number);
      const text=textLines((await page.getTextContent({disableNormalization:false})).items);
      page.cleanup();
      if(text){pages.push({number,text:text.slice(0,220000-chars)});chars+=text.length;}else blank++;
    }
    return {pages,totalPages:doc.numPages,warning:!pages.length?'PDF_NEEDS_OCR':(limit<doc.numPages || chars>=220000 ? 'PDF_TRUNCATED' : blank?'PDF_PARTIAL_TEXT':null)};
  } catch(error) {
    return {pages:[],warning:error.name==='PasswordException'?'PDF_PASSWORD_REQUIRED':'PDF_INVALID',detail:error.name||'PDF_ERROR'};
  } finally { await task.destroy().catch(()=>{}); }
}
module.exports={extractPdf,textLines};
