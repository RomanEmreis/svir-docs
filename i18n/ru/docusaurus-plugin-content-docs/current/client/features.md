---
sidebar_position: 4
title: Фичи и TLS
description: Фичи Cargo, что включает каждая и как выбрать криптопровайдер для rustls.
---

# Фичи и TLS

svir — один крейт без процедурных макросов. Его фичи решают, какую часть вы
собираете.

| Фича | Включает | По умолчанию |
|---|---|---|
| `client` | `Client`, `EventStream`, транспорт на hyper, вложения с диска | Да |
| `tls-ring` | HTTPS через rustls с провайдером ring и корнями webpki | Нет |
| `tls-aws-lc` | HTTPS через rustls с провайдером aws-lc-rs и корнями webpki | Нет |
| `schemars` | `Tools::add` и `Schema::of`, которые выводят из типа схему входных данных инструмента и схему ответа | Нет |
| `tracing` | [Слой `Trace`](./layers#trace) | Нет |

Оба протокола, Chat Completions и Anthropic Messages API, всегда входят в
крейт: протокол, которому не нужно ничего сверх того, что в svir уже есть, не
выносится в фичу.

По `Cargo.toml` проекта видно, что ему доступно:

| Что там | Что это значит |
|---|---|
| `svir = "0.2"` и нет ключа `features` | Клиент по обычному HTTP: всё, кроме HTTPS, `Tools::add`, `Schema::of` и `Trace` |
| `features = ["tls-ring"]` или `["tls-aws-lc"]` | Клиент по HTTP и HTTPS |
| `features = ["schemars"]` | `Tools::add` и `Schema::of`; крейту для derive нужен ещё `schemars = "1"` |
| `features = ["tracing"]` | Слой `Trace` |
| `default-features = false` | Только типы и кодеки: нет `Client`, `EventStream`, слоёв и вложений с диска. См. [Кодек сам по себе](../advanced/codec) |

Что ещё нужно вашему крейту и когда:

| Для | Добавьте |
|---|---|
| Любого использования `Client` | `tokio` с рантаймом; клиент работает на Tokio |
| Типизированных аргументов инструментов, `Completion::parse` | `serde` с `derive` |
| Схемы инструмента, написанной вручную | `serde_json` |
| `Tools::add`, `Schema::of` | `schemars = "1"` рядом с фичей `schemars` у svir |
| Собственного HTTP-бэкенда | `bytes` и `futures-core` |

## TLS и криптопровайдер {/* #tls-and-the-crypto-provider */}

Серверу модели на loopback хватает обычного HTTP, поэтому в сборке по умолчанию
TLS нет. HTTPS — это rustls с корнями webpki и HTTP/2 через ALPN, с тем
криптопровайдером, который выбрала ваша сборка:

| Фича | Провайдер |
|---|---|
| `tls-ring` | ring. Собирается везде без C-тулчейна |
| `tls-aws-lc` | aws-lc-rs. Если включены обе фичи, используется эта |

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.2", features = ["tls-ring"] }
```

Без них URL `https://` — ошибка `Config` в `build()`, и ошибка называет обе
фичи. Встроенный транспорт не следует редиректам, не использует прокси и
доверяет корням по умолчанию; для всего остального см.
[Собственный HTTP-бэкенд](./custom-backend).

svir всегда явно передаёт свой провайдер в rustls, поэтому работает с любым.
Но выбор всё равно важен для остальной сборки: rustls выбирает провайдер по
умолчанию на весь процесс, только если скомпилирован ровно один. Если другая
зависимость приносит aws-lc-rs, как умеет reqwest, возьмите `tls-aws-lc`,
чтобы провайдер в сборке был один; с добавленным ring код в другом месте,
полагающийся на умолчание (`ClientConfig::builder()`), запаникует с
сообщением «no process-level CryptoProvider available». Другой способ —
исправить этот код: передать провайдер и там или установить его при старте через `CryptoProvider::install_default`.

## Версии {/* #versions */}

Этот сайт описывает svir **0.2**. Что меняется при обновлении с более раннего
релиза, — на странице [Миграция](../reference/migration), а все изменения — в
[журнале изменений](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md).
