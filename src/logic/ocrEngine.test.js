import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanOcrText, chooseOcrResult } from './ocrEngine.js';

function attempt(text, confidence = 80, mode = '6') {
  return { text, confidence, mode, variant: 'gray' };
}

test('не возвращает ложный текст с банки без этикетки', () => {
  const garbage = '‚ —— — — ООлщщННННННННННННННННе\nии лы,\nЕ = нЕ НН ОВЕ';
  assert.equal(cleanOcrText(garbage), '');
  const ocr = chooseOcrResult([attempt(garbage, 91), attempt('т“\n===', 83)]);
  assert.equal(ocr.text, '');
  assert.equal(ocr.noText, true);
  assert.equal(ocr.confidence, null);
});

test('не возвращает мусор со стилизованной этикетки', () => {
  const garbage = 'ут.\nч. Ш\n"литу у; —\nис.\nИ ЧН\n[НО';
  assert.equal(chooseOcrResult([attempt(garbage, 90)]).text, '');
});

test('сохраняет читаемый кириллический текст без дополнения сведений', () => {
  const text = 'Состав: мёд натуральный, малина.\nМасса нетто: 250 г';
  assert.equal(cleanOcrText(text), text);
  const ocr = chooseOcrResult([attempt(text, 85)]);
  assert.equal(ocr.text, text);
  assert.equal(ocr.noText, false);
});

test('выбирает читаемую попытку вместо шумной с высокой уверенностью', () => {
  const result = chooseOcrResult([attempt('— — ННННННН', 99), attempt('малиновый', 76, '11')]);
  assert.equal(result.text, 'малиновый');
});

test('краткие слова без доказательств не принимаются', () => {
  assert.equal(cleanOcrText('ОВЕ\nНН\nУ.'), '');
  assert.equal(cleanOcrText('Мёд'), 'Мёд');
});

test('строки с низкой уверенностью отбрасываются', () => {
  const blocks = [{ paragraphs: [{ lines: [{ text: 'Дальневосточный', words: [{text: 'Дальневосточный', confidence: 20}], confidence: 20 }] }] }];
  const result = chooseOcrResult([{ text: 'Дальневосточный', blocks, confidence: 90, mode: '6', variant: 'gray' }]);
  assert.equal(result.text, '');
});
