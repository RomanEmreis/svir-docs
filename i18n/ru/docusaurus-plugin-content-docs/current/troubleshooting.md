---
sidebar_position: 6
title: Диагностика
description: Симптом → причина, во время выполнения и при компиляции.
---

# Диагностика

Что обычно означает симптом. Что такое каждый вид ошибки — см.
[Ошибки](./errors). Тексты ошибок svir приводятся как есть, по-английски.

## Во время выполнения {/* #at-runtime */}

### Сборка клиента {/* #building-the-client */}

| Симптом | Обычная причина |
|---|---|
| `Config`: «plain HTTP to a host that is not loopback» | URL — `http://` на другую машину. Используйте `https://` или `.allow_http()` для доверенной сети |
| `Config`: «an https URL needs the `tls` or the `tls-aws-lc` feature» | `default-features = false` без любой из них |
| `Config`: «the API key variable ... is not set» | `api_key_env` называет переменную, которой у процесса нет. svir не читает файл `.env` |
| `Config`: «http() must be called before layers are added» | Поднимите `.http(backend)` выше `.layer(..)` и `.wrap(..)` |
| `Config`: «a header name is not valid» | В имени, переданном в `.header(..)`, есть пробел или другой символ, недопустимый в имени заголовка |
| `Config`: «the header ... is set by svir, not by the caller» | `.header(..)` назвал `authorization`, `content-type`, `content-length`, `accept`, `host`, `transfer-encoding` или `connection`. Bearer-ключ передаётся через `api_key` |
| `Config`: «the value of header ... is not valid» | В значении перевод строки, другой управляющий символ или не-ASCII текст. Часто это значение, прочитанное из файла вместе с завершающим переводом строки: обрежьте его |
| Паника в другом месте: «no process-level CryptoProvider available» | Скомпилированы два провайдера rustls: `tls` у svir принёс ring рядом с aws-lc-rs из другого крейта. Возьмите svir с `tls-aws-lc`; см. [Фичи и TLS](./client/features#tls-and-the-crypto-provider) |

### Отправка {/* #sending */}

| Симптом | Обычная причина |
|---|---|
| `Transport`, и `is_unsent()` истинно | По этому URL никто не слушает: сервер не запущен или порт не тот |
| `Unsupported`, detail «HTTP 404» | Базовый URL указывает не на API (лишний сегмент пути, веб-интерфейс), или сервер не знает модель. `server_message()` обычно говорит, что именно |
| `Unsupported`, detail «HTTP 400» или «HTTP 422» | Сервер отверг запрос. Прочитайте `server_message()`. Частые причины: модель без поддержки инструментов или изображений, или сообщение, которое не принимает chat template сервера |
| `ContentFilter`, detail «HTTP 400» | Контент-фильтр Azure OpenAI заблокировал промпт. Ничего не сгенерировано, но проверка оплачена: промпт нужно менять, а не отправлять снова |
| `Unsupported`: «the response is not an event stream» | Успешный статус с HTML или JSON: страница шлюза или эндпоинт, который игнорирует `stream` |
| `ContextOverflow` ещё до отправки | Задан `context_tokens`, и байты тела плюс `max_tokens` его превышают. Байты сильно завышают изображения |
| `ContextOverflow` от сервера | Диалог перерос контекст. Некоторые серверы говорят это внутри потока со статусом `200`; svir сообщает об обоих случаях одинаково |
| `Unsupported`: «a tool call is required, and the request offers no tools» | `ToolChoice::Required` в запросе без инструментов. Добавьте их через `.tool(..)` или `.tools(&toolbox)` |
| `Unsupported`: «a call is required of a tool the request does not offer» | `ToolChoice::tool(name)` называет инструмент, которого в запросе нет: опечатка или инструмент не добавлен |
| `Unsupported`, detail «HTTP 400», в запросе с выбором инструмента или форматом ответа | Сервер его не принимает, а svir никогда не отправляет запрос без него. LM Studio отвергает названный инструмент (используйте `Required` с этим единственным инструментом) и `ResponseFormat::Json` (используйте `Schema`). OpenAI отвергает `Json`, если в сообщениях нет слова «JSON»; OpenAI и Azure OpenAI отвергают строгую схему, объекты которой не перечисляют все свойства в `required` с `additionalProperties: false` |
| `Attachment`: «an image has no media type» | Расширение не из `png`, `jpg`, `jpeg`, `gif`, `webp`. Добавьте `.media_type(..)` |
| `Attachment`: «a text file is not UTF-8» | `TextFile` — для текста. Изображение отправляйте как `Image`, остальное сначала конвертируйте |
| `Attachment`: «a text file is not the escaped length it declares» | `TextFile::escaped_len` объявил длину, которой у файла быть не может, или которой нет у текста в памяти. Измерьте весь файл через `svir::body::escaped_len` |
| `Attachment`: «an attachment changed after the body was built, or is not the length it declares» | В файл записали между измерением и отправкой, или объявленный `escaped_len` неверен |

### Пока ответ стримится {/* #while-the-answer-streams */}

| Симптом | Обычная причина |
|---|---|
| `Unsupported`: «a delta field outside the protocol» или другое «outside the protocol» | Строгий разбор встретил то, чего svir не знает. Посмотрите, что присылает сервер (пример `relay` это печатает); `.lenient()` пропускает такие поля |
| `Unsupported`: «a finish reason outside the protocol» | Сервер остановился по неизвестной svir причине (отфильтрованный ответ — это `FinishReason::ContentFilter`, а не это). Мягкий режим здесь ничего не меняет |
| `Protocol`: «an answer that is both content and a refusal» или «a refusal with tool calls» | Сервер сам себе противоречит в том, что считать ответом. Сообщите об этом, приложив сырой поток; мягкий режим здесь ничего не меняет |
| `Timeout`: «the server sent no response» или «the response stalled» | Тишина дольше таймаута простоя (5 мин по умолчанию). Локальной модели на длинном промпте может понадобиться больше; увеличьте `idle_timeout` |
| `Timeout` от слоя `Timeout::first_token` на локальной модели | Дедлайн короче, чем модели нужно на чтение промпта |
| `TruncatedStream` | Соединение оборвалось: собственный таймаут шлюза, упавший сервер или выгруженная модель |
| `ResponseLimit` | Ответ больше 64 МиБ, событие больше 256 КиБ или больше 64 вызовов инструментов. Поднимите `Limits`, если это ожидаемо |

### Сам ответ {/* #the-answer-itself */}

| Симптом | Обычная причина |
|---|---|
| `done.usage` равен `None` | Сервер не сообщает расход токенов, или он отверг поле и клиент перестал его запрашивать |
| `done.text` начинается с пустых строк | Сервер оставил их после рассуждений. Обрезайте при показе |
| `done.text` пуст, а `finish` — `Length` | Рассуждения израсходовали весь бюджет вывода. Поднимите `max_tokens` или уменьшите глубину |
| `done.text` пуст, а `finish` — `ToolCalls` | Это не сбой: модель ждёт результатов инструментов |
| `finish` — `ContentFilter`, хотя весь ответ уже пришёл | Асинхронный контент-фильтр Azure проверяет ответ после того, как тот отправлен, и заблокировал его часть. Уберите текст, который увидел пользователь |
| `finish` — `Refusal` | Модель отказалась отвечать, и `done.text` — её отказ: покажите его. Когда просят формат, модели OpenAI отказываются, а не дают ответ, который не станут в него укладывать |
| `parse` падает: «the answer is not whole: it finished with Length» | Лимит вывода обрезал ответ: поднимите `max_tokens`. При другой названной причине текст — тоже не тот ответ, о котором просили |
| `parse` падает, а `done.text` пуст | LM Studio с включёнными рассуждениями прислал JSON как рассуждения. Добавьте `.reasoning(Effort::Off)` |
| `parse` падает на ответе, который выглядит правильно | Тип и схема расходятся, или формат ответа не задан, и модель обернула JSON в прозу или блок кода. Выведите схему из типа через `Schema::of` |
| Модель никогда не вызывает инструмент | У модели нет поддержки инструментов, или описание не говорит, когда инструментом пользоваться |
| Модель отвечает без вызова, которого требовал `tool_choice` | Сервер принял выбор и не выполнил его, как LM Studio с `Required`. svir это не проверяет: смотрите `done.calls` |
| Цикл с обязательным вызовом инструмента никогда не заканчивается ответом | Выбор остаётся в запросе на каждом ходу. Вместе с результатами задайте `.tool_choice(ToolChoice::Auto)` |
| Следующий запрос после вызова инструмента отвергается | Не хватает реплики ассистента или результата: `request.assistant(done).tool_results(results)` |
| Один и тот же ответ, какую модель ни назови | Некоторые локальные серверы отвечают загруженной моделью, если не знают ID. Выведите список моделей |
| Запрос к модели один раз медленный, потом быстрый | Локальный сервер загрузил модель при первом запросе |

## При компиляции {/* #at-compile-time */}

| Компилятор говорит | Причина |
|---|---|
| No variant `System` on `Role` | Системный промпт — это `Request::system(..)` |
| Cannot create a non-exhaustive struct with a struct expression | Используйте конструктор: `Request::new`, `Tool::new`, `ToolResult::new`, `ToolResult::error`, `Schema::new`, `Usage::new` |
| Non-exhaustive patterns on `Event`, `ErrorKind`, `FinishReason`, `Part`, `ToolChoice`, `ResponseFormat` | Добавьте ветку по умолчанию |
| Use of moved value: `request` | Билдер принимает `self`. Пишите `request = request.user(..)`, а в `complete` и `stream` передавайте `&request` |
| No method `add` on `Tools` | Включите фичу `schemars` у svir или используйте `add_tool` со схемой |
| No function `of` on `Schema` | Включите фичу `schemars` у svir или напишите схему через `Schema::new` |
| `T: DeserializeOwned` is not satisfied, from `parse` | Тип не выводит `Deserialize` или заимствует: `parse` возвращает владеющее значение, поэтому поле — `String`, а не `&str` |
| The trait `JsonSchema` is not implemented | Ваш `schemars` не версии 1, поэтому его derive — другой трейт |
| Cannot find `Trace` in `svir::layer` | Включите фичу `tracing` |
| Cannot find `Client` in `svir` | `default-features = false` выключил фичу `client` |
| `Layer`, `Next`, `Retry` или `Decoder` not found | Их нет в прелюдии: `svir::layer::..`, `svir::openai::chat::..` |
| Mismatched types: expected `Client<..>`, found `Client` | Клиент с собственным бэкендом — это `Client<Backend>`; назовите тип или обобщите по `B: svir::http::Backend` |
| A future is not `Send`, в реализации `Layer` или `Toolbox` | Что-то не `Send` (`Rc`, `std::sync::MutexGuard`) удерживается через `.await` |
| Expected `ToolResult`, found `Result<..>` в `Toolbox::call` | `call` возвращает результат для модели, а не ошибку: превратите сбой в `ToolResult::error(&call.id, message)` |
