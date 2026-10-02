---
sidebar_position: 4
title: Диалоги
description: Диалог — это запрос. История, отправка рассуждений обратно, сохранение и восстановление.
---

# Диалоги

Клиент ничего не хранит между вызовами. **Диалог — это запрос**, и владеет им
вызывающий код: каждая реплика добавляет сообщение пользователя, отправляет
запрос и кладёт ответ модели обратно в него.

```rust
use svir::prelude::*;

async fn converse(client: &Client, lines: Vec<String>) -> Result<(), Error> {
    let mut request = Request::new("qwen3-27b").system("You are a concise assistant.");

    for line in lines {
        request = request.user(line);

        let done = client.complete(&request).await?;
        println!("{}", done.text.trim());

        // The answer goes back as it is: text, tool calls, reasoning.
        request = request.assistant(done);
    }

    Ok(())
}
```

## Возвращайте сам итоговый ответ {/* #put-the-completion-itself-back */}

`request.assistant(done)` забирает `Completion` по значению и превращает его в
сообщение ассистента — с рассуждениями, текстом и вызовами инструментов.
Если он нужен вам где-то ещё, сначала склонируйте его. `Message::from(done)`
делает то же самое для кода, который собирает сообщения вручную.

Если восстановить реплику ассистента из `done.text` через
`Message::assistant(..)`, вызовы инструментов и их ID потеряются. Для
сохранённого диалога без инструментов это нормально, для живого — нет.

## История — ваша {/* #history-is-yours */}

- История растёт с каждой репликой. Обрезать или сжимать её — политика
  приложения; запрос, который перестал помещаться, падает с
  `ErrorKind::ContextOverflow`.
- Если вызов упал, уже добавленное сообщение пользователя остаётся в запросе.
  Решите, оставить его для повтора или собрать запрос заново.
- Создайте один `Client` на сервер и свободно клонируйте его. Много диалогов
  могут делить один клиент: он хранит соединения, а не чаты.

## Отправка рассуждений обратно {/* #sending-reasoning-back */}

Рассуждения из прошлых ответов хранятся в истории, но не отправляются, пока в
запросе нет `.send_reasoning(true)`. Когда они отправляются, то идут в том
поле, в котором пришли (`reasoning_content` или `reasoning`): сервер ждёт своё
поле обратно без изменений. Рассуждения, вырезанные из inline-тегов `<think>`,
не отправляются никогда.

```rust
use svir::prelude::*;

fn with_reasoning(request: Request) -> Request {
    // For servers that want the model's earlier reasoning in the history.
    request.send_reasoning(true)
}
```

## Сохранение и восстановление {/* #storing-and-restoring */}

`Request`, `Message`, `Part`, `Completion` и остальные публичные типы данных
реализуют `Serialize` и `Deserialize`. Их serde-представление — часть
публичного API и закреплено тестами крейта, так что сохранённый диалог — это
формат, на который можно опираться, а не случайность раскладки структур.

```rust
use svir::prelude::*;

fn roundtrip(request: &Request) -> Result<Request, serde_json::Error> {
    let stored = serde_json::to_string(request)?;

    serde_json::from_str(&stored)
}
```

Вложение, заданное путём, сохраняется как путь, а заданное байтами — как
base64. Сохранённый путь должен снова существовать в момент отправки.

Чтобы восстановить диалог из собственного хранилища, используйте
конструкторы: `Message::user(..)`, `Message::assistant(..)` и
`Message::tool_result(..)`. Публичные типы данных помечены
`#[non_exhaustive]`, поэтому литералами структур их не собрать.
