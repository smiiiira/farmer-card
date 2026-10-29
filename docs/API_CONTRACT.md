# API-контракт интеграции (проект, не реализован)

> В текущем MVP нет сервера. Контракт описывает, как можно подключить витрину / CRM / маркетплейс, не изменяя принцип ручной проверки.

## Сущность `Draft`

```json
{
  "id": "draft_123",
  "status": "needs_review",
  "product": {
    "name": null,
    "category": null,
    "producer": "учебный образец",
    "weight": "250 г",
    "composition": "мёд натуральный, малина",
    "shelfLife": null,
    "region": null
  },
  "ocr": {
    "language": "rus",
    "text": "Состав: мёд натуральный, малина.\\nМасса нетто: 250 г",
    "confidence": 82,
    "requiresHumanReview": true,
    "sourcePhotoIds": ["photo_1"]
  },
  "readiness": { "score": 75, "kind": "field_completeness" },
  "moderation": {
    "type": "preliminary",
    "issues": [ {"field": "name", "code": "REQUIRED", "message": "Укажите название товара"} ]
  },
  "missingFields": ["name"],
  "confirmedByUser": false
}
```

Значения иллюстративные. `confidence` — уверенность OCR, не вероятность истинности характеристик.

## Endpoints

| Метод | URL | Назначение |
|---|---|---|
| `POST` | `/api/v1/drafts` | Создать черновик из фото / исходных полей; вернуть id и статус |
| `GET` | `/api/v1/drafts/{id}` | Получить черновик, оценку, ошибки и OCR с источником |
| `PATCH` | `/api/v1/drafts/{id}` | Изменить факты, отметить поля как проверенные |
| `POST` | `/api/v1/drafts/{id}/confirm` | Ручное подтверждение (отклонить при критических пропусках) |

### `POST /api/v1/drafts`

`multipart/form-data`, поля `photos[]` (JPEG/PNG/WEBP), `product` (JSON исходных сведений), `language=rus`; ответ `201 Created` + объект `Draft`.

### `PATCH /api/v1/drafts/{id}`

```json
{
  "product": {"name": "Мёд малиновый"},
  "verifiedFields": ["name", "composition", "weight"]
}
```

### `POST /api/v1/drafts/{id}/confirm`

```json
{"confirm": true, "reviewerId": "seller_42"}
```

Ответ `200 OK`: `{"id":"draft_123","status":"confirmed"}`; `422 Unprocessable Entity`, если обязательные поля не заполнены.

## Коды ошибок / безопасность

- `400` — неверный формат запроса, `401` — нет авторизации, `404` — черновик не найден, `413` — слишком большое фото, `415` — неподдерживаемый формат, `422` — не пройдены проверки, `429` — ограничение запросов.
- В боевой версии — проверка MIME и размера, авторизация продавца, контроль доступа к черновику, ограничение времени хранения фото, журнал подтверждений и защита загрузок.
