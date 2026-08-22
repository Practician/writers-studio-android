# Writers Studio Android

Автономная Android-версия Writers Studio. React-интерфейс собирается внутрь APK через Capacitor; собственный Node/Express-сервер для работы приложения **не нужен**. Приложение обращается к выбранному AI-провайдеру напрямую по HTTPS.

## Ox Alpha через OpenRouter

В этой версии **Ox Alpha** задана моделью по умолчанию для OpenRouter: `stealth/ox-alpha`. После установки APK пользователь указывает **свой личный ключ OpenRouter**; приложение выполняет прямые запросы к `https://openrouter.ai/api/v1/chat/completions`.

> Ключ не включается в APK или GitHub. Он вводится после установки и хранится только на устройстве в Android secure storage. Не передавайте его другим пользователям и при подозрении на утечку немедленно удалите ключ в кабинете OpenRouter.[1]

| Шаг | Действие |
| --- | --- |
| 1 | Создайте личный API-ключ в [OpenRouter Keys](https://openrouter.ai/keys). |
| 2 | Установите APK и откройте Writers Studio. |
| 3 | Нажмите кнопку **API** в шапке приложения. |
| 4 | Вставьте ключ в поле **OpenRouter** и сохраните настройки. |
| 5 | Выберите **OpenRouter** в переключателе провайдеров. Приложение подставит `stealth/ox-alpha`. |
| 6 | Используйте «Муза», «Написать», «Продолжить», редактуру и редакторского агента как обычно. |

Ox Alpha — временная Stealth-модель, поэтому она может стать недоступной без предупреждения. Если OpenRouter возвращает ошибку `404`, `429` или `503`, в настройках можно выбрать другой провайдер или дождаться восстановления доступа.[2] [3]

## Конфиденциальность

При прямом режиме текст из APK отправляется в OpenRouter и далее внешнему Stealth-провайдеру. Не отправляйте пароли, ключи доступа, финансовые сведения и иные чувствительные данные. Карточка модели сообщает, что prompts и completions сохраняются у провайдера; общие условия Stealth также устанавливают особые правила обработки контента.[2] [3]

## Редакторский агент

Агент встроен в **Текст → Проверить → Передать главу редакторскому агенту** и выполняет маршрут:

> Контекст книги → диагностика главы → бережная правка → финальный аудит → редакторское письмо.

Он использует тот же выбранный личный ключ OpenRouter и модель Ox Alpha, если в переключателе выбран OpenRouter.

## Локальная разработка и сборка

```bash
npm ci
npm run lint
npm test
npm run build
npx cap sync android
```

Для запуска web-версии в автономном режиме:

```bash
npm run dev
```

Чтобы открыть native-проект в Android Studio:

```bash
npx cap open android
```

## GitHub Actions

После каждого push в `master` или `main` workflow `.github/workflows/android-apk.yml` выполняет проверку типов, тесты, Vite build, Capacitor sync и создаёт debug APK. APK прикрепляется к prerelease во вкладке **Releases**; копия также доступна в **Actions → Artifacts** на 14 дней.

Для подписанного production APK/AAB нужен отдельный signing workflow. В GitHub Secrets хранятся только keystore и пароли подписи; **ключ OpenRouter туда не добавляется**.

## Источники

[1]: https://openrouter.ai/docs/api_reference/authentication "OpenRouter API Authentication"
[2]: https://openrouter.ai/stealth/ox-alpha "Ox Alpha — OpenRouter"
[3]: https://openrouter.ai/terms/stealth "Stealth Program End User License Agreement"
