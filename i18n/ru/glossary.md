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
| thinking block | блок рассуждений | Рассуждения в Messages API; `ReasoningSource::Thinking` |
| adaptive thinking | адаптивные рассуждения | Рассуждения, глубину которых модель выбирает сама в пределах `Effort` |
| signature | подпись | Подпись блока рассуждений; `Reasoning::signature` |
| redacted thinking | скрытые рассуждения | Блок рассуждений без текста; `ReasoningSource::RedactedThinking` |
| stop reason | причина остановки | Поле `stop_reason` Messages API; svir переводит её в `FinishReason` |
| reasoning parser | парсер рассуждений | Часть сервера, которая отделяет рассуждения от ответа (`--reasoning-parser` у vLLM) |
| chat template | шаблон чата | Шаблон модели, который собирает промпт из сообщений |
| usage | расход токенов | `Usage` |
| finish reason | причина завершения | `FinishReason` |
| refusal | отказ | Отказ модели отвечать; `FinishReason::Refusal` |
| content filter | контент-фильтр | `ErrorKind::ContentFilter`, `FinishReason::ContentFilter` |
| annotation | аннотация | Вердикт асинхронного контент-фильтра Azure по уже отправленному тексту |
| tool | инструмент | Функция, которую модель может вызвать |
| tool call | вызов инструмента | `ToolCall` |
| cut call | обрезанный вызов | Вызов, который оборвал лимит вывода; `Completion::cut_calls`, не для выполнения |
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
| round | раунд | Один диалог внешнего цикла туториала: от нового запроса до конца цикла с инструментами |
| notes | заметки | Файл, который модель ведёт, чтобы следующий раунд начался с них |
| budget | бюджет | Предел токенов на весь запуск |
| workspace | рабочая область | Крейт, над которым работает модель в туториале; не путать с workspace Cargo |
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
| lean retry | повтор без необязательных полей | Вторая попытка обработки совместимости; `ClientBuilder::lean_retry` |
| crypto provider | криптопровайдер | ring или aws-lc-rs |
| feature (Cargo) | фича | Фича Cargo: `client`, `tls-ring`, `schemars`… |
| loopback | loopback | Не переводится |
| drop | drop | Освобождение значения в Rust; не переводится |
| skill | скилл | Agent Skill |
| Messages API | Messages API | Не переводится; Anthropic Messages API |
| gateway | шлюз | Прокси перед API с собственной авторизацией |
| migration | миграция | Страница о том, что менять при обновлении |
| crate | крейт | |
