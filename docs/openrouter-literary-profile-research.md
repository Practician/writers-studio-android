# OpenRouter: проверка альтернатив литературному профилю

Дата проверки: 2026-08-22.

Источник: <https://openrouter.ai/api/v1/models?category=roleplay&output_modalities=text>

Публичный ответ каталога OpenRouter подтвердил наличие следующих текстовых моделей в категории `roleplay`:

| ID | Название в каталоге | Подтверждённые свойства, полезные для APK |
|---|---|---|
| `deepseek/deepseek-v4-flash-0731` | DeepSeek V4 Flash 0731 | Текстовая модель, контекст до 1 310 720 токенов, поддерживает `temperature`, `max_tokens`; доступна в актуальном каталоге. |
| `deepseek/deepseek-v3.2` | DeepSeek V3.2 | Текстовая модель, контекст 163 840 токенов, поддерживает `temperature`, `max_tokens`; доступна в актуальном каталоге. |
| `xiaomi/mimo-v2.5-pro` | Xiaomi MiMo-V2.5-Pro | Текстовая модель, контекст до 1 050 000 токенов, поддерживает `temperature`, `max_tokens`; доступна в актуальном каталоге. |
| `openrouter/free` | Free Models Router | Автоматически выбирает свободную модель из текущего пула; список доступных бесплатных моделей изменчив. |

Решение для интерфейса: убрать `mistralai/mistral-small-creative`; предложить два конкретных профиля DeepSeek для связной длинной прозы и `openrouter/free` как автоматический запасной вариант. Не объявлять модель «лучшей» без авторского A/B-теста на одном и том же фрагменте русской прозы.

Дополнительный источник fallback: <https://openrouter.ai/docs/guides/routing/routers/free-router>.

Каталог OpenRouter позволяет фильтровать модели по категории `roleplay`, выходной модальности `text`, доступным параметрам и контексту: <https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties>.

References:
- [OpenRouter Models API](https://openrouter.ai/api/v1/models?category=roleplay&output_modalities=text)
- [OpenRouter Free Router](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [OpenRouter Models API reference](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties)
