# Глоссарий терминов

Ключевые термины документации svir и их перевод на русский. Термины применяются единообразно во всей документации; имена типов, методов и фич в коде не переводятся.

| Английский термин | Русский перевод | Примечание |
|-------------------|-----------------|------------|
| large language model (LLM) | большая языковая модель (LLM) | Аббревиатура LLM не переводится |
| model server | сервер модели | LM Studio, llama.cpp, vLLM и т. п. |
| wire protocol | протокол обмена | То, что идёт по сети между приложением и сервером |
| request | запрос | Тип `Request` |
| answer, response | ответ | |
| completion | итоговый ответ (`Completion`) | Последнее событие потока, весь ответ целиком |
| stream | поток | `EventStream`, `RawStream` |
| event | событие | `Event` |
| delta | дельта | Кусок ответа в потоке |
| conversation | диалог | История сообщений в запросе |
| system prompt | системный промпт | |
| message | сообщение | |
| part | часть | Часть сообщения: текст, изображение, файл… |
| role | роль | `User`, `Assistant`, `Tool` |
| attachment | вложение | `Image`, `TextFile` |
| escaped length | длина после экранирования | Длина текста, экранированного в JSON-строку; `TextFile::escaped_len` |
| reasoning | рассуждения | Ход мысли модели (reasoning) |
| reasoning effort | глубина рассуждений | `Effort` |
| usage | расход токенов | `Usage` |
| finish reason | причина завершения | `FinishReason` |
| refusal | отказ | Отказ модели отвечать; `FinishReason::Refusal` |
| content filter | контент-фильтр | `ErrorKind::ContentFilter`, `FinishReason::ContentFilter` |
| annotation | аннотация | Вердикт асинхронного контент-фильтра Azure по уже отправленному тексту |
| tool | инструмент | Функция, которую модель может вызвать |
| tool call | вызов инструмента | `ToolCall` |
| tool result | результат инструмента | `ToolResult` |
| failed result | неудачный результат | `ToolResult::error`, флаг `is_error` |
| tool choice | выбор инструмента | `ToolChoice`, `Request::tool_choice` |
| registry | реестр | `Tools` |
| handler | обработчик | |
| schema | схема | JSON Schema входных данных инструмента или ответа; `Schema` |
| strict schema | строгая схема | `Schema::strict`; не путать со строгим режимом разбора |
| structured output | структурированный вывод | Ответ в JSON или в JSON по схеме |
| response format | формат ответа | `ResponseFormat`, `Request::response_format` |
| loop | цикл | Цикл, возвращающий модели результаты инструментов |
| layer | слой | Middleware вокруг вызова (`Layer`) |
| middleware | middleware | Не переводится |
| retry | повтор | `Retry` |
| backoff | пауза перед повтором (backoff) | |
| timeout | таймаут | |
| idle timeout | таймаут простоя | |
| strict / lenient | строгий / мягкий режим | `Mode::Strict`, `Mode::Lenient` |
| limit | лимит | `Limits` |
| encoder / decoder | кодировщик / декодер | `Encoder`, `Decoder` |
| codec | кодек | |
| backend | бэкенд | Реализация `http::Backend` |
| transport | транспорт | |
| header | заголовок | HTTP-заголовок; `ClientBuilder::header` |
| proxy | прокси | |
| relay | ретрансляция | Передача байтов сервера дальше без изменений |
| compatibility handling | обработка совместимости | Запоминание полей, которые сервер отвергает |
| crypto provider | криптопровайдер | ring или aws-lc-rs |
| feature (Cargo) | фича | Фича Cargo: `client`, `tls`, `schemars`… |
| loopback | loopback | Не переводится |
| drop | drop | Освобождение значения в Rust; не переводится |
| skill | скилл | Agent Skill |
| crate | крейт | |
