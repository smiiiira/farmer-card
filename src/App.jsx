import { useEffect, useRef, useState } from "react";
import { createWorker } from "tesseract.js";
import { prepareOcrImage, chooseOcrResult } from "./logic/ocrEngine";
import { extractFactsFromText } from "./logic/cardEngine";
import {
  createEmptyFacts,
  validateFacts,
  calculateReadiness,
  generateDescription,
} from "./logic/cardEngine";
import "./App.css";

const DRAFT_KEY = "farmer-card-draft";

const OCR_MODES = {
  composition: [{ mode: '6', variant: 'gray' }, { mode: '6', variant: 'binary' }, { mode: '11', variant: 'original' }],
  title: [{ mode: '7', variant: 'gray' }, { mode: '6', variant: 'binary' }, { mode: '11', variant: 'original' }],
};

const clamp01 = number => Math.max(0, Math.min(1, number));


function App() {
  const [facts, setFacts] = useState(createEmptyFacts);
  const [image, setImage] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [ocrConfidence, setOcrConfidence] = useState(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(1);
  const [notice, setNotice] = useState("");
  const [ocrStatus, setOcrStatus] = useState("");
  const [ocrAttempts, setOcrAttempts] = useState([]);
  const [ocrMode, setOcrMode] = useState("composition");
  const [crop, setCrop] = useState(null);
  const [dragStart, setDragStart] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [reviewed, setReviewed] = useState(false);
  const [fileName, setFileName] = useState("");

  const fileRef = useRef(null);
  const imageUrlRef = useRef("");
  const cropStageRef = useRef(null);

  const problems = validateFacts(facts);
  const readiness = calculateReadiness(facts, problems);
  const description = generateDescription(facts);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved?.facts) setFacts(saved.facts);
      if (saved?.ocrText) setOcrText(saved.ocrText);
      if (typeof saved?.ocrConfidence === "number") {
        setOcrConfidence(saved.ocrConfidence);
      }
      // Blob URL не переживает перезагрузку страницы, поэтому фото в localStorage не восстанавливаем.
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }

    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    };
  }, []);

  function updateFact(key, value) {
    setReviewed(false);
    setFacts((current) => ({ ...current, [key]: value }));
    setNotice("");
  }

  function handleImage(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    imageUrlRef.current = previewUrl;
    setSelectedFile(file);
    setImage(previewUrl);
    setCrop(null);
    setDragStart(null);
    setOcrText("");
    setOcrConfidence(null);
    setOcrAttempts([]);
    setReviewed(false);
    setFileName(file.name);
    setOcrStatus('Выделите область с текстом и нажмите «Распознать текст».');
    setNotice("");
  }

  function pointerCoordinates(event) {
    const rect = cropStageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }

  function beginCrop(event) {
    if (busy || !selectedFile) return;
    const point = pointerCoordinates(event);
    if (!point) return;
    cropStageRef.current?.setPointerCapture(event.pointerId);
    setDragStart(point);
    setCrop({ ...point, width: 0, height: 0 });
  }

  function moveCrop(event) {
    if (!dragStart) return;
    const point = pointerCoordinates(event);
    if (!point) return;
    setCrop({
      x: Math.min(point.x, dragStart.x),
      y: Math.min(point.y, dragStart.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  }

  function endCrop(event) {
    if (!dragStart) return;
    const point = pointerCoordinates(event);
    if (point) {
      const rectangle = {
        x: Math.min(point.x, dragStart.x),
        y: Math.min(point.y, dragStart.y),
        width: Math.abs(point.x - dragStart.x),
        height: Math.abs(point.y - dragStart.y),
      };
      setCrop(rectangle.width > 0.04 && rectangle.height > 0.04 ? rectangle : null);
    }
    setDragStart(null);
  }

  async function runOcr() {
    if (!selectedFile || busy) return;
    setBusy(true);
    setNotice('');
    setOcrStatus('Распознавание русского текста…');
    setOcrAttempts([]);
    let worker;
    try {
      worker = await createWorker('rus');
      const attempts = [];
      for (const { mode, variant } of OCR_MODES[ocrMode]) {
        const prepared = await prepareOcrImage(selectedFile, variant, crop);
        await worker.setParameters({
          tessedit_pageseg_mode: mode,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        });
        const result = await worker.recognize(prepared, {}, { text: true, blocks: true });
        attempts.push({
          mode, variant, text: result.data.text,
          blocks: result.data.blocks,
          confidence: result.data.confidence,
        });
      }
      const best = chooseOcrResult(attempts);
      setOcrText(best.text);
      setOcrConfidence(best.confidence);
      setOcrAttempts(best.attempts);
      setOcrStatus(best.noText
        ? 'Надёжный русский текст не обнаружен. Это может означать, что надписи нет, она слишком мелкая или стилизованная. Попробуйте выделить этикетку точнее, сделать более чёткое фото или введите текст вручную.'
        : 'OCR нашёл возможный русский текст. Все слова требуют сверки с фотографией: движок может ошибаться даже при высокой уверенности.');
      setNotice(best.noText
        ? 'OCR не смог уверенно прочитать надпись. Случайные символы скрыты.'
        : 'Предварительный текст получен. Проверьте его, прежде чем переносить данные в карточку.');
      setStep(2);
    } catch (error) {
      console.error('Ошибка OCR:', error);
      setOcrStatus('Распознавание не удалось. Текст можно ввести вручную.');
      setNotice(`Ошибка OCR: ${error.message}. При первом запуске нужен интернет для загрузки русской модели.`);
    } finally {
      if (worker) {
        try { await worker.terminate(); } catch (error) { console.warn('Не удалось завершить OCR worker', error); }
      }
      setBusy(false);
    }
  }

  function saveDraft() {
    try {
      // Сохраняем данные, но не временный blob URL изображения.
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({ facts, ocrText, ocrConfidence })
      );
      setNotice("Черновик сохранён в этом браузере. Фотографию нужно будет загрузить повторно после перезагрузки страницы.");
    } catch {
      setNotice("Не удалось сохранить черновик. Попробуйте уменьшить объём данных.");
    }
  }

  function exportDraft() {
    const data = {
      schemaVersion: "1.1",
      status: reviewed && problems.length === 0 ? "confirmed" : "draft",
      product: facts,
      description,
      readiness,
      validation: problems,
      ocr: {
        text: ocrText,
        confidence: ocrConfidence,
        status: ocrStatus,
        requiresHumanReview: !reviewed,
        attempts: ocrAttempts,
      },
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob(
      [JSON.stringify(data, null, 2)],
      { type: "application/json;charset=utf-8" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "farmer-card.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function resetDraft() {
    setFacts(createEmptyFacts());
    setImage("");
    setSelectedFile(null);
    setCrop(null);
    setDragStart(null);
    setFileName("");
    setOcrText("");
    setOcrConfidence(null);
    setOcrStatus("");
    setOcrAttempts([]);
    setReviewed(false);
    setStep(1);
    setNotice("");
    localStorage.removeItem(DRAFT_KEY);

    if (imageUrlRef.current) {
      URL.revokeObjectURL(imageUrlRef.current);
      imageUrlRef.current = "";
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="brand">СВОЁ РОДНОЕ</div>
          <div className="brand-subtitle">Фермер.Карточка</div>
        </div>
        <span className="topbar-note">Инструмент подготовки товара к публикации</span>
      </header>

      <main className="container">
        <section className="hero">
          <div>
            <div className="eyebrow">КАРТОЧКА ТОВАРА · MVP</div>
            <h1>От фотографии<br />до готового черновика</h1>
            <p>
              Распознайте данные с упаковки, проверьте характеристики
              и подготовьте структурированную карточку товара.
            </p>
          </div>

          <div className="score-card">
            <span className="muted-label">ЗАПОЛНЕННОСТЬ ПОЛЕЙ</span>
            <div className="score">{readiness}%</div>
            <div className="progress">
              <div style={{ width: `${readiness}%` }} />
            </div>
            <span className="score-caption">
              {problems.length
                ? `Замечаний: ${problems.length}`
                : "Обязательные поля заполнены"}
            </span>
          </div>
        </section>

        <nav className="steps">
          {[
            ["1", "Фото"],
            ["2", "Данные"],
            ["3", "Предпросмотр"],
          ].map(([number, label], index) => (
            <button
              key={number}
              className={`step ${step === index + 1 ? "active" : ""} ${
                step > index + 1 ? "complete" : ""
              }`}
              onClick={() => setStep(index + 1)}
            >
              <span>{step > index + 1 ? "✓" : number}</span>
              {label}
            </button>
          ))}
        </nav>

        {step === 1 && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Фотография товара</h2>
                <p>Загрузите этикетку или упаковку с читаемым текстом.</p>
              </div>
              <span className="tag">OCR</span>
            </div>

            <p className="aside-copy">Сначала загрузите фотографию. Затем, удерживая кнопку мыши или касаясь экрана, выделите только этикетку с текстом. Без выделения распознаётся всё фото.</p>
            <label className="field" style={{maxWidth:420,marginBottom:16}}>
              <span>Тип текста</span>
              <select value={ocrMode} onChange={event => setOcrMode(event.target.value)}>
                <option value="composition">Состав / несколько строк</option>
                <option value="title">Название / крупная надпись</option>
              </select>
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              hidden
              onChange={handleImage}
            />

            {!image ? (
              <button
                className="dropzone"
                onClick={() => fileRef.current?.click()}
              >
                <span className="plus">+</span>
                <strong>Выбрать фотографию</strong>
                <span>PNG, JPG или WEBP</span>
              </button>
            ) : (
              <div className="photo-box">
                <div
                  className="crop-stage"
                  ref={cropStageRef}
                  onPointerDown={beginCrop}
                  onPointerMove={moveCrop}
                  onPointerUp={endCrop}
                  onPointerCancel={endCrop}
                >
                  <img src={image} alt="Загруженный товар — выделите область текста" draggable={false} />
                  {crop && <div className="crop-selection" style={{
                    left: `${crop.x * 100}%`, top: `${crop.y * 100}%`,
                    width: `${crop.width * 100}%`, height: `${crop.height * 100}%`,
                  }} />}
                </div>
                {busy && <div className="photo-status">Распознаём выбранную область. Русская модель OCR загружается из сети при первом запуске…</div>}
              </div>
            )}

            <div className="button-row">
              {image && <>
                <button className="button secondary" onClick={() => fileRef.current?.click()} disabled={busy}>
                  Заменить фото
                </button>
                <button className="button secondary" onClick={() => setCrop(null)} disabled={busy || !crop}>
                  Сбросить выделение
                </button>
                <button className="button primary" onClick={runOcr} disabled={busy}>
                  {busy ? "Распознаём…" : `Распознать текст ${crop ? 'в выделенной области' : 'на всём фото'} →`}
                </button>
              </>}
              <button className="button secondary" disabled={busy} onClick={() => setStep(2)}>
                Ввести текст вручную →
              </button>
            </div>
          </section>
        )}

        {step === 2 && (
          <div className="workspace">
            <div className="main-column">
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Распознанный текст</h2>
                    <p>OCR может ошибаться — проверьте исходный текст.</p>
                  </div>
                  <span className="tag">Источник: фото</span>
                </div>

                {typeof ocrConfidence === "number" && (
                  <p className="aside-copy">
                    Уверенность OCR: {Math.round(ocrConfidence)} из 100. Это оценка распознавания текста, а не достоверности сведений о товаре.
                  </p>
                )}

                {ocrStatus && <p className="aside-copy">{ocrStatus}</p>}
                {ocrAttempts.length > 0 && <p className="aside-copy">Попытки OCR: {ocrAttempts.map(a => `${a.variant}/PSM${a.mode}: ${a.acceptedLines} строк принято`).join(' · ')}. Ненадёжные строки не выводятся.</p>}

                <textarea
                  className="ocr-area"
                  value={ocrText}
                  onChange={(event) => {setOcrText(event.target.value); setReviewed(false);}}
                  placeholder="После распознавания здесь появится текст с упаковки. Можно также вставить его вручную."
                />
              </section>

              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>Характеристики</h2>
                    <p>Значения можно исправлять и дополнять вручную.</p>
                  </div>
                </div>

                <div className="button-row">
                  <button className="button secondary" onClick={() => {
                    const suggestions = extractFactsFromText(ocrText);
                    const keys = Object.keys(suggestions);
                    if (!keys.length) { setNotice('Явных полей не найдено. Заполните характеристики по этикетке вручную.'); return; }
                    setFacts(current => { const next = {...current}; for (const key of keys) if (!next[key]) next[key] = suggestions[key]; return next; });
                    setReviewed(false);
                    setNotice(`Предложены поля: ${keys.join(', ')}. Сверьте значения с фотографией.`);
                  }}>Предложить поля из OCR (без догадок)</button>
                </div>
                <div className="fields">
                  <Field label="Название товара" value={facts.name}
                    onChange={(v) => updateFact("name", v)} />
                  <Field label="Категория" value={facts.category}
                    onChange={(v) => updateFact("category", v)} />
                  <Field label="Производитель" value={facts.producer}
                    onChange={(v) => updateFact("producer", v)} />
                  <Field label="Вес" placeholder="Например, 500 г" value={facts.weight}
                    onChange={(v) => updateFact("weight", v)} />
                  <Field label="Состав" value={facts.composition}
                    onChange={(v) => updateFact("composition", v)} />
                  <Field label="Срок годности" placeholder="Например, 12 месяцев"
                    value={facts.shelfLife}
                    onChange={(v) => updateFact("shelfLife", v)} />
                  <Field label="Регион производства" value={facts.region}
                    onChange={(v) => updateFact("region", v)} />
                </div>

                <div className="button-row">
                  <button className="button secondary" onClick={() => setStep(1)}>
                    ← Выделить другую область / повторить OCR
                  </button>
                  <button className="button primary" onClick={() => setStep(3)}>
                    Предпросмотр →
                  </button>
                </div>
              </section>
            </div>

            <aside className="panel validation-panel">
              <h2>Проверка данных</h2>
              <p className="aside-copy">
                Проверяем заполненность выбранных полей и формат веса.
              </p>

              {problems.length === 0 ? (
                <div className="success">
                  <strong>Базовые проверки пройдены</strong>
                  <span>Это не означает официальную проверку товара.</span>
                </div>
              ) : (
                <div className="problem-list">
                  {problems.map((problem) => (
                    <button
                      className="problem"
                      key={problem.field}
                      onClick={() => {
                        document.getElementById(problem.field)?.focus();
                      }}
                    >
                      <strong>{problem.label}</strong>
                      <span>{problem.message}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="legend">
                <span>OCR — распознано с фото</span>
                <span>Поля — требуют проверки человеком</span>
              </div>
            </aside>
          </div>
        )}

        {step === 3 && (
          <div className="preview-layout">
            <section className="panel product-card">
              <div className="preview-top">
                <span className="tag">ЧЕРНОВИК</span>
                <span>Заполненность: {readiness}%</span>
              </div>

              {image && <img className="product-image" src={image} alt="Товар" />}

              <div className="product-body">
                <span className="category">{facts.category || "Категория не указана"}</span>
                <h2>{facts.name || "Название товара не указано"}</h2>
                <p className="description">
                  {description || "Заполните характеристики, чтобы сформировать описание."}
                </p>

                <div className="attributes">
                  {[
                    ["Производитель", facts.producer],
                    ["Вес", facts.weight],
                    ["Состав", facts.composition],
                    ["Срок годности", facts.shelfLife],
                    ["Регион", facts.region],
                  ].filter(([, value]) => value).map(([label, value]) => (
                    <div className="attribute" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <aside className="panel actions-panel">
              <h2>Черновик карточки</h2>
              <div className="score">{readiness}%</div>
              <p className="aside-copy">
                Проверьте исходные данные перед использованием карточки.
                Автоматическая проверка не заменяет требования площадки.
              </p>

              <label className="field" style={{marginBottom:16}}>
                <span><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} /> Я лично сверил(а) значения с упаковкой</span>
              </label>
              <p className="aside-copy">Предварительная модерация: {problems.length ? `Нужно исправить ${problems.length} замечаний` : reviewed ? 'Базовые проверки пройдены; подтверждено человеком' : 'Поля заполнены, ожидается ручное подтверждение'}. {image ? `Фото: ${fileName}.` : 'Фото отсутствует.'}</p>
              <button className="button primary full" onClick={saveDraft}>
                Сохранить черновик
              </button>
              <button className="button secondary full" onClick={exportDraft}>
                Экспортировать JSON
              </button>
              <button className="button secondary full" onClick={() => setStep(2)}>
                ← Редактировать данные
              </button>
              <button className="button danger full" onClick={resetDraft}>
                Начать заново
              </button>
            </aside>
          </div>
        )}

        {notice && <div className="notice">{notice}</div>}
      </main>

      <footer>Фермер.Карточка · Прототип для кейса «Своё Родное»</footer>
    </div>
  );
}

function Field({ label, value, onChange, placeholder = "" }) {
  const id = {
    "Название товара": "name",
    "Производитель": "producer",
    "Вес": "weight",
    "Состав": "composition",
  }[label] || undefined;

  return (
    <label className="field">
      <span>{label}</span>
      <input
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

export default App;
