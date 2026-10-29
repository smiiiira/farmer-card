
const REQUIRED_FIELDS = [
  { key: "name", label: "Название товара" },
  { key: "producer", label: "Производитель" },
  { key: "weight", label: "Вес" },
  { key: "composition", label: "Состав" },
];

export function createEmptyFacts() {
  return {
    name: "",
    category: "",
    producer: "",
    weight: "",
    composition: "",
    shelfLife: "",
    region: "",
  };
}

function cleanValue(value) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.—–-]+|[\s;,.—–-]+$/g, "")
    .trim();
}

export function extractFactsFromText(text) {
  const facts = {};
  const source = text.replace(/\r/g, "\n");

  // Не восстанавливаем полное название по отдельным словам.
  // Название вводится пользователем по упаковке.

  // Вес с единицей измерения: 500 г, 250 гр, 1 кг, 500 g.
  const weight = source.match(
    /\b(\d+(?:[.,]\d+)?)\s*(гр|кг|г|kg|g)(?![A-Za-zА-Яа-яЁё])/i
  );

  if (weight) {
    facts.weight = `${weight[1]} ${weight[2]}`;
  }

  // Состав извлекается только при наличии соответствующей подписи.
  const composition = source.match(
    /состав\s*[:—–-]\s*([^\n]+)/i
  );

  if (composition) {
    const value = cleanValue(composition[1]);
    if (value) facts.composition = value;
  }

  // Производитель извлекается только из строки с явной подписью.
  const producer = source.match(
    /(?:производитель|изготовитель)\s*[:—–-]\s*([^\n]+)/i
  );

  if (producer) {
    const value = cleanValue(producer[1]);
    if (value) facts.producer = value;
  }

  return facts;
}

export function validateFacts(facts) {
  const problems = [];

  for (const field of REQUIRED_FIELDS) {
    if (!facts[field.key]?.trim()) {
      problems.push({
        field: field.key,
        label: field.label,
        severity: "error",
        message: `Не заполнено поле «${field.label}»`,
      });
    }
  }

  if (
    facts.weight &&
    !/^\s*\d+(?:[.,]\d+)?\s*(г|гр|кг|kg|g)\s*$/i.test(
      facts.weight
    )
  ) {
    problems.push({
      field: "weight",
      label: "Вес",
      severity: "warning",
      message: "Укажите вес с единицей измерения, например 500 г",
    });
  }

  return problems;
}

export function calculateReadiness(facts, problems) {
  const filled = REQUIRED_FIELDS.filter(
    (field) => facts[field.key]?.trim()
  ).length;

  const baseScore = Math.round(
    (filled / REQUIRED_FIELDS.length) * 100
  );

  const warnings = problems.filter(
    (problem) => problem.severity === "warning"
  ).length;

  return Math.max(0, baseScore - warnings * 5);
}

export function generateDescription(facts) {
  const parts = [];

  if (facts.name) parts.push(`${facts.name}.`);

  if (facts.composition) {
    parts.push(`Состав: ${facts.composition}.`);
  }

  if (facts.weight) {
    parts.push(`Вес: ${facts.weight}.`);
  }

  if (facts.producer) {
    parts.push(`Производитель: ${facts.producer}.`);
  }

  if (facts.region) {
    parts.push(`Регион производства: ${facts.region}.`);
  }

  if (facts.shelfLife) {
    parts.push(`Срок годности: ${facts.shelfLife}.`);
  }

  return parts.join(" ");
}
