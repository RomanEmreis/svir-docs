---
sidebar_position: 3
title: Фичи и TLS
description: Фичи Cargo, что включает каждая и как выбрать криптопровайдер для rustls.
---

# Фичи и TLS

svir — один крейт без процедурных макросов. Его фичи решают, какую часть вы
собираете.

| Фича | Включает | По умолчанию |
|---|---|---|
| `client` | `Client`, `EventStream`, транспорт на hyper, вложения с диска | Да |
| `tls` | HTTPS через rustls с провайдером ring и корнями webpki | Да |
| `tls-aws-lc` | HTTPS с провайдером aws-lc-rs вместо ring | Нет |
| `schemars` | `Tools::add`, который выводит схему входных данных инструмента из типа аргумента | Нет |
| `tracing` | [Слой `Trace`](./layers#trace) | Нет |

По `Cargo.toml` проекта видно, что ему доступно:

| Что там | Что это значит |
|---|---|
| `svir = "0.1"` и нет ключа `features` | `client` и `tls`: всё, кроме `Tools::add` и `Trace` |
| `features = ["schemars"]` | `Tools::add`; крейту для derive нужен ещё `schemars = "1"` |
| `features = ["tracing"]` | Слой `Trace` |
| `default-features = false` | Только типы и кодек: нет `Client`, `EventStream`, слоёв и вложений с диска. См. [Кодек сам по себе](../advanced/codec) |
| `default-features = false, features = ["client"]` | Клиент без HTTPS: URL `https://` — ошибка `Config` в `build()` |
| `default-features = false, features = ["client", "tls-aws-lc"]` | HTTPS с aws-lc-rs вместо ring |

Что ещё нужно вашему крейту и когда:

| Для | Добавьте |
|---|---|
| Любого использования `Client` | `tokio` с рантаймом; клиент работает на Tokio |
| Типизированных аргументов инструментов | `serde` с `derive` |
| Схемы инструмента, написанной вручную | `serde_json` |
| `Tools::add` | `schemars = "1"` рядом с фичей `schemars` у svir |
| Собственного HTTP-бэкенда | `bytes` и `futures-core` |

## TLS и криптопровайдер {/* #tls-and-the-crypto-provider */}

HTTPS — это rustls с корнями webpki и HTTP/2 через ALPN. Встроенный транспорт
не следует редиректам, не использует прокси и доверяет корням по умолчанию;
для всего остального см. [Собственный HTTP-бэкенд](./custom-backend).

Криптопровайдер выбирается фичей:

| Фича | Провайдер |
|---|---|
| `tls` (по умолчанию) | ring. Собирается везде без C-тулчейна |
| `tls-aws-lc` | aws-lc-rs. Если включены обе фичи, используется эта |

svir всегда явно передаёт свой провайдер в rustls, поэтому работает с любым.
Но выбор всё равно важен для остальной сборки: rustls выбирает провайдер по
умолчанию на весь процесс, только если скомпилирован ровно один. Если другая
зависимость приносит aws-lc-rs (так умеет reqwest), то `tls` у svir добавит
ring, и код в другом месте, полагающийся на умолчание
(`ClientConfig::builder()`), запаникует с сообщением «no process-level
CryptoProvider available».

Возьмите тот провайдер, что уже есть в сборке:

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.2", default-features = false, features = ["client", "tls-aws-lc"] }
```

Другой способ — исправить код, который полагается на умолчание: передать
провайдер и там или установить его при старте через
`CryptoProvider::install_default`.

## Версии {/* #versions */}

Этот сайт описывает svir **0.1.2**. В пределах 0.1 более поздние релизы
ставятся без изменений кода; чего нет в более ранних:

| Зафиксирована | Чего нет |
|---|---|
| 0.1.0 | `Error::status()`, фичи `tls-aws-lc`, лимита по умолчанию в 64 МиБ (был 4 МиБ) и исправления для inline-тегов `<think>`, разрезанных между дельтами |
| 0.1.1 | `FinishReason::ContentFilter` (отфильтрованный ответ был `Unsupported`) и потоков Azure OpenAI в строгом режиме |

Подробности — в
[журнале изменений](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md).
