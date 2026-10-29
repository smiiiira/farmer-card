/**
 * Conservative Russian OCR. A photograph is evidence, not a trusted product fact.
 * Nothing is spell-corrected or generated: unclear text is withheld for manual entry.
 */
const RUSSIAN = /[А-Яа-яЁё]/g;
const VOWEL = /[аеёиоуыэюя]/i;
const LETTERS = /[А-Яа-яЁёA-Za-z]/g;
const SHORT_WORDS = new Set(['мёд', 'мед', 'сок', 'чай', 'сыр', 'рис', 'лук', 'мак', 'рожь', 'соль']);

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF\uFFFD]/g, '')
    .replace(/[\u00AD]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isReadableWord(input) {
  const word = input.toLowerCase().replace(/^[^а-яё]+|[^а-яё]+$/g, '');
  if (!word || word.length < 3 || !VOWEL.test(word)) return false;
  if (/(.)\1{3,}/u.test(word)) return false;
  if (/[^аеёиоуыэюяьъй]{6,}/i.test(word)) return false;
  if (/([а-яё]{2})\1{2,}/i.test(word)) return false;
  return word.length >= 4 || SHORT_WORDS.has(word);
}

function inspectLine(text) {
  const line = normalizeText(text)
    .replace(/^[^А-Яа-яЁё0-9]+/, '')
    .replace(/[^А-Яа-яЁёA-Za-z0-9%.)]+$/, '');
  const cyrillic = (line.match(RUSSIAN) || []).length;
  const alphabetic = (line.match(LETTERS) || []).length;
  const digits = (line.match(/[0-9]/g) || []).length;
  const words = (line.match(/[А-Яа-яЁё]+/g) || []).filter(isReadableWord);
  const longWords = words.filter(word => word.length >= 5).length;
  // Cyrillic is mandatory; Latin-only English packaging must not become Russian text.
  const plausible = cyrillic >= 3 && alphabetic > 0 && cyrillic / alphabetic >= 0.8
    && ((alphabetic + digits) / Math.max(1, line.length)) >= 0.62
    && words.length >= 1
    && (longWords >= 1 || words.length >= 2 || words.some(word => SHORT_WORDS.has(word.toLowerCase())));
  return { line, plausible, words, longWords };
}

/** Only orthographic filtering, no word reconstruction or dictionary substitutions. */
export function cleanOcrText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(inspectLine)
    .filter(line => line.plausible)
    .map(({ line }) => line)
    .join('\n');
}

function linesFromBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  const lines = [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of paragraph.lines || []) {
        const words = (line.words || []).filter(w => Number.isFinite(w.confidence) && w.text?.trim());
        const reliable = words.filter(w => w.confidence >= 40 && /[а-яё]/i.test(w.text));
        const weighted = reliable.reduce((sum, w) => sum + w.confidence * w.text.length, 0);
        const length = reliable.reduce((sum, w) => sum + w.text.length, 0);
        const confidence = length ? weighted / length : line.confidence;
        lines.push({ text: line.text, confidence: confidence || 0, wordCount: words.length });
      }
    }
  }
  return lines;
}

function filteredAttempt(attempt) {
  const blockLines = linesFromBlocks(attempt.blocks);
  const source = blockLines.length ? blockLines : String(attempt.text || '')
    .split(/\r?\n/)
    .map(text => ({ text, confidence: attempt.confidence || 0 }));
  const lines = source.map(row => ({ ...inspectLine(row.text), confidence: Number(row.confidence) || 0 }))
    .filter(row => row.plausible && row.confidence >= (
      row.longWords ? 55 : 65
    ));
  // One sentence can be high confidence even if short; avoid arbitrary minimum total length.
  const confidence = lines.length
    ? lines.reduce((sum, row) => sum + row.confidence, 0) / lines.length
    : 0;
  const result = lines.map(row => row.line).join('\n');
  return {
    text: result,
    confidence,
    mode: attempt.mode,
    variant: attempt.variant,
    acceptedLines: lines.length,
    rejectedLines: source.filter(row => normalizeText(row.text)).length - lines.length,
  };
}

/** Returns empty text when nothing sufficiently supported can be detected. */
export function chooseOcrResult(attempts) {
  const candidates = attempts.map(filteredAttempt).map(item => ({
    ...item,
    // Text quality and OCR confidence drive ranking; length never increases the score.
    score: item.text ? item.confidence + Math.min(5, item.acceptedLines) : -100,
  })).sort((a, b) => b.score - a.score);
  const best = candidates[0] || { text: '', confidence: 0, score: -100 };
  return {
    text: best.text,
    confidence: best.text ? Math.round(best.confidence) : null,
    mode: best.mode,
    variant: best.variant,
    noText: !best.text,
    attempts: candidates.map(({ mode, variant, confidence, acceptedLines, rejectedLines }) => ({
      mode, variant, confidence: Math.round(confidence), acceptedLines, rejectedLines,
    })),
  };
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фотографию')); };
    image.src = url;
  });
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function createGrayImage(data, variant) {
  const pixels = data.data;
  const intensities = new Uint8Array(pixels.length / 4);
  const hist = new Uint32Array(256);
  for (let i = 0; i < intensities.length; i++) {
    const p = i * 4;
    const value = Math.round(0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]);
    intensities[i] = value;
    hist[value]++;
  }
  // Percentile autocontrast avoids amplifying isolated highlights.
  const cutoff = Math.round(intensities.length * 0.015);
  let sum = 0; let low = 0; let high = 255;
  for (let i = 0; i < 256; i++) { sum += hist[i]; if (sum >= cutoff) { low = i; break; } }
  sum = 0;
  for (let i = 255; i >= 0; i--) { sum += hist[i]; if (sum >= cutoff) { high = i; break; } }
  const stretch = high - low >= 35;
  // Otsu global binarization is a useful alternative on light paper labels;
  // it can hurt colored packaging, so we also run an original-color OCR pass.
  let threshold = 128;
  if (variant === 'binary') {
    const total = intensities.length;
    const totalSum = hist.reduce((acc, count, value) => acc + value * count, 0);
    let background = 0; let backgroundSum = 0; let variance = -1;
    for (let t = 0; t < 256; t++) {
      background += hist[t];
      if (!background || background === total) continue;
      backgroundSum += t * hist[t];
      const foreground = total - background;
      const diff = backgroundSum / background - (totalSum - backgroundSum) / foreground;
      const score = background * foreground * diff * diff;
      if (score > variance) { variance = score; threshold = t; }
    }
  }
  for (let i = 0; i < intensities.length; i++) {
    let gray = intensities[i];
    if (variant === 'binary') gray = gray > threshold ? 255 : 0;
    else if (stretch) gray = clamp((gray - low) * 255 / (high - low), 0, 255);
    const p = i * 4;
    pixels[p] = pixels[p + 1] = pixels[p + 2] = gray;
  }
}

export async function prepareOcrImage(file, variant = 'gray', crop = null) {
  const image = await imageFromFile(file);
  const x = crop ? clamp(crop.x, 0, 0.98) : 0;
  const y = crop ? clamp(crop.y, 0, 0.98) : 0;
  const width = crop ? clamp(crop.width, 0.02, 1 - x) : 1;
  const height = crop ? clamp(crop.height, 0.02, 1 - y) : 1;
  const sx = Math.round(image.naturalWidth * x);
  const sy = Math.round(image.naturalHeight * y);
  const sw = Math.max(1, Math.round(image.naturalWidth * width));
  const sh = Math.max(1, Math.round(image.naturalHeight * height));
  const scale = clamp(1650 / Math.max(sw, sh), 1, 4);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Не удалось подготовить фотографию');
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  if (variant !== 'original') {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    createGrayImage(data, variant);
    ctx.putImageData(data, 0, 0);
  }
  return canvas;
}
