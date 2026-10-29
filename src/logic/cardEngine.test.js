import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyFacts, extractFactsFromText, validateFacts, calculateReadiness, generateDescription } from './cardEngine.js';

test('не выдумывает название, категорию или состав при отсутствии меток', () => {
  assert.deepEqual(extractFactsFromText('мёд малиновый баночка 250'), {});
});

test('извлекает только сведения с явными подписями и массой', () => {
  assert.deepEqual(extractFactsFromText('Состав: мёд натуральный, малина.\nМасса нетто: 250 г\nИзготовитель: учебный образец'), {
    weight: '250 г', composition: 'мёд натуральный, малина', producer: 'учебный образец'
  });
});

test('выявляет незаполненные обязательные поля', () => {
  const p = validateFacts(createEmptyFacts());
  assert.equal(p.length, 4);
  assert.deepEqual(p.map(x => x.field), ['name','producer','weight','composition']);
});

test('готовность показывает заполненность и штраф за некорректный вес', () => {
  const facts = { ...createEmptyFacts(), name: 'Учебный пример', producer:'Учебный образец', composition:'мёд', weight: '250' };
  const problems = validateFacts(facts);
  assert.equal(calculateReadiness(facts, problems), 95);
  assert.ok(problems.some(x=>x.field==='weight' && x.severity==='warning'));
});

test('описание использует только явно заполненные поля', () => {
  assert.equal(generateDescription({...createEmptyFacts(), name:'Учебный пример', weight:'250 г'}), 'Учебный пример. Вес: 250 г.');
});
