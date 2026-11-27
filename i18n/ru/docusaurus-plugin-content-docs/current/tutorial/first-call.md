---
sidebar_position: 2
title: Проект и первый вызов
description: Клиент для OpenAI-совместимого сервера или Anthropic Messages API, выбранный при запуске программы, и ответ о падающих тестах, потоком.
---

# Проект и первый вызов

В этой главе у программы появляется клиент: она запускает тесты и спрашивает
модель, почему они падают. Ответ выводится в терминал по мере того, как
модель его пишет.

## Создайте проект {/* #create-the-project */}

Рядом с каталогом `wordfreq`:

```bash
cargo new ralph
cd ralph
```

Добавьте зависимости в `Cargo.toml`:

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.2", features = ["schemars", "tls-ring"] }
tokio = { version = "1", features = ["macros", "rt-multi-thread", "fs", "process", "time"] }
serde = { version = "1", features = ["derive"] }
schemars = "1"
```

- **`svir`** с `schemars` выводит схему инструмента из типа Rust — она
  понадобится в следующей главе, — а с `tls-ring` говорит по HTTPS с
  хостинговым сервером. Серверу на вашей машине TLS не нужен; см.
  [Фичи и TLS](../client/features).
- **`tokio`** — рантайм, на котором работает svir. `fs`, `process` и `time`
  нужны для файлов, `cargo test` и его дедлайна.
- **`serde`** читает аргументы инструмента в тип, а **`schemars`** пишет для
  модели схему этого типа. Оба понадобятся в следующей главе.

## Выберите сервер при запуске {/* #choose-the-server-when-the-program-starts */}

`Client::openai` и `Client::anthropic` оба возвращают `ClientBuilder`, и оба
строят один и тот же `Client`. Какой из них использует программа, решает
переменная окружения, и ничто после `client()` разницы не знает:

```rust skip
/// A client for the server `RALPH_API` names.
fn client() -> Result<Client, Failure> {
    let (mut builder, key) = match std::env::var("RALPH_API").as_deref() {
        Ok("anthropic") => (Client::anthropic(), "ANTHROPIC_API_KEY"),
        Ok("openai") | Err(_) => (Client::openai("http://127.0.0.1:1234"), "OPENAI_API_KEY"),
        Ok(other) => return Err(format!("RALPH_API is openai or anthropic, not {other}").into()),
    };
    if let Ok(url) = std::env::var("RALPH_URL") {
        builder = builder.base_url(url);
    }
    if std::env::var_os(key).is_some() {
        builder = builder.api_key_env(key);
    }

    Ok(builder.build()?)
}
```

| Переменная | Что задаёт | Если не задана |
|---|---|---|
| `RALPH_API` | `openai` для OpenAI-совместимого сервера, `anthropic` для Messages API | `openai` |
| `RALPH_URL` | Где сервер | `http://127.0.0.1:1234` или Anthropic API |
| `RALPH_MODEL` | Модель | Обязательна |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Ключ для используемого API | Без ключа: локальному серверу он не нужен |

svir сам не читает переменных окружения: их читает программа и передаёт
билдеру. `api_key_env` читает ключ, когда выполняется `build()`, и не пускает
его ни в одну ошибку и ни в одну строку лога. `Failure` — тип ошибки
программы,
[упакованная ошибка](https://doc.rust-lang.org/book/ch09-02-recoverable-errors-with-result.html#where-the--operator-can-be-used),
в которую `?` превращает любую ошибку.

## Запустите тесты {/* #run-the-tests */}

Рабочая область — это крейт, над которым работает модель. Её `test` запускает
там `cargo test`:

```rust skip
/// Runs `cargo test` in the crate.
async fn test(&self) -> std::io::Result<Tests> {
    let run = Command::new("cargo")
        .args(["test", "--quiet", "--color", "never"])
        .current_dir(&self.root)
        .stdin(Stdio::null())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(TEST_TIME, run).await??;

    let mut printed = String::from_utf8_lossy(&output.stdout).into_owned();
    printed.push_str(&String::from_utf8_lossy(&output.stderr));
    Ok(Tests {
        passed: output.status.success(),
        output: tail(&printed, OUTPUT_CHARS).to_owned(),
    })
}
```

- **Одна фиксированная команда, без оболочки.** Аргументы — это список, так
  что в них ничего не интерпретируется, и модель их никогда не выбирает.
- **Дедлайн.** Тест, который не заканчивается, останавливается через
  `TEST_TIME`: `timeout` бросает запуск, а `kill_on_drop` убивает вместе с ним
  `cargo`.
- **Конец вывода.** Cargo пишет, что упало, в конце, поэтому модель получает
  последние `OUTPUT_CHARS` символов: этого хватает на шесть падений и
  достаточно мало, чтобы промпт оставался небольшим.

Рабочая область хранит корень в `Arc<Path>`, чтобы её клон был дешёвым:
каждому инструменту в следующей главе нужен свой.

## Спросите модель {/* #ask-the-model */}

```rust skip
async fn run() -> Result<(), Failure> {
    let model = std::env::var("RALPH_MODEL").map_err(|_| "set RALPH_MODEL to a model")?;
    let root = std::env::args().nth(1).ok_or("usage: ralph <crate>")?;
    let workspace = Workspace::new(root);
    let client = client()?;

    let tests = workspace.test().await?;
    if tests.passed {
        println!("the tests pass");
        return Ok(());
    }

    let question = format!("Why do these tests fail? Be brief.\n\n{}", tests.output);
    let request = Request::new(&model).max_tokens(MAX_TOKENS).user(question);
    show(client.stream(&request).await?).await?;

    Ok(())
}
```

Запрос — это весь диалог: здесь одно сообщение пользователя. `max_tokens`
ограничивает ответ. Messages API отвергает запрос без него, поэтому программа
задаёт его всегда, с каким бы API она ни говорила.

`client.stream` возвращается, как только сервер начинает отвечать, с потоком
событий. `show` печатает текст по мере прихода и возвращает весь ответ,
который всегда приходит последним событием:

```rust skip
/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
            }
            Event::Completed(done) => {
                println!();
                return Ok(done);
            }
            _ => {}
        }
        std::io::stdout().flush().ok();
    }

    Err(Error::new(ErrorKind::TruncatedStream))
}
```

Ветка `_` пропускает то, чего эта глава не показывает: рассуждения модели и
куски вызовов инструментов. Поток, который закончился без `Completed`, уже
выдал ошибку, так что до последней строки дело не доходит; компилятору там
всё равно нужно значение. Все события — в [Чтении ответа](../basics/answers).

Когда что-то идёт не так, `main` печатает ошибку и слова самого сервера, если
он их прислал:

```rust skip
#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("ralph: {failure}");
            let error = failure.downcast_ref::<Error>();
            if let Some(message) = error.and_then(Error::server_message) {
                eprintln!("the server says: {message}");
            }
            ExitCode::FAILURE
        }
    }
}
```

## Запустите {/* #run-it */}

С LM Studio, который отдаёт `qwen/qwen3.8-27b`:

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
They fail because the implementation isn’t normalizing/filtering tokens correctly:

- Punctuation is kept as part of words (`"(world)"`, `"Hello,"`, etc.).
- Words aren’t lowercased, so `river`, `River`, and `RIVER` don’t merge.
- It doesn’t split on all whitespace, so tabs/newlines remain or empty tokens appear.
- Non-word tokens like `""` and `"..."` aren’t filtered out.
- Results aren’t sorted alphabetically for ties.
```

Та же программа с Anthropic API:

```bash
RALPH_API=anthropic ANTHROPIC_API_KEY=sk-ant-... RALPH_MODEL=claude-opus-5-5 cargo run -- ../wordfreq
```

<details>
<summary>Весь <code>src/main.rs</code></summary>

```rust
use std::{
    io::Write,
    path::{Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::Arc,
    time::Duration,
};

use svir::prelude::*;
use tokio::process::Command;

/// Tokens one answer may take.
const MAX_TOKENS: u64 = 16_000;

/// How much of the test output the model sees, from the end.
const OUTPUT_CHARS: usize = 6_000;

/// How long `cargo test` may run.
const TEST_TIME: Duration = Duration::from_secs(300);

/// What went wrong, for the person who runs the program.
type Failure = Box<dyn std::error::Error>;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(failure) => {
            eprintln!("ralph: {failure}");
            let error = failure.downcast_ref::<Error>();
            if let Some(message) = error.and_then(Error::server_message) {
                eprintln!("the server says: {message}");
            }
            ExitCode::FAILURE
        }
    }
}

async fn run() -> Result<(), Failure> {
    let model = std::env::var("RALPH_MODEL").map_err(|_| "set RALPH_MODEL to a model")?;
    let root = std::env::args().nth(1).ok_or("usage: ralph <crate>")?;
    let workspace = Workspace::new(root);
    let client = client()?;

    let tests = workspace.test().await?;
    if tests.passed {
        println!("the tests pass");
        return Ok(());
    }

    let question = format!("Why do these tests fail? Be brief.\n\n{}", tests.output);
    let request = Request::new(&model).max_tokens(MAX_TOKENS).user(question);
    show(client.stream(&request).await?).await?;

    Ok(())
}

/// A client for the server `RALPH_API` names.
fn client() -> Result<Client, Failure> {
    let (mut builder, key) = match std::env::var("RALPH_API").as_deref() {
        Ok("anthropic") => (Client::anthropic(), "ANTHROPIC_API_KEY"),
        Ok("openai") | Err(_) => (Client::openai("http://127.0.0.1:1234"), "OPENAI_API_KEY"),
        Ok(other) => return Err(format!("RALPH_API is openai or anthropic, not {other}").into()),
    };
    if let Ok(url) = std::env::var("RALPH_URL") {
        builder = builder.base_url(url);
    }
    if std::env::var_os(key).is_some() {
        builder = builder.api_key_env(key);
    }

    Ok(builder.build()?)
}

/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
            }
            Event::Completed(done) => {
                println!();
                return Ok(done);
            }
            _ => {}
        }
        std::io::stdout().flush().ok();
    }

    Err(Error::new(ErrorKind::TruncatedStream))
}

/// The crate the model works on.
#[derive(Clone)]
struct Workspace {
    root: Arc<Path>,
}

/// What `cargo test` said.
struct Tests {
    passed: bool,
    output: String,
}

impl Workspace {
    fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Arc::from(root.into()),
        }
    }

    /// Runs `cargo test` in the crate.
    async fn test(&self) -> std::io::Result<Tests> {
        let run = Command::new("cargo")
            .args(["test", "--quiet", "--color", "never"])
            .current_dir(&self.root)
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .output();
        let output = tokio::time::timeout(TEST_TIME, run).await??;

        let mut printed = String::from_utf8_lossy(&output.stdout).into_owned();
        printed.push_str(&String::from_utf8_lossy(&output.stderr));
        Ok(Tests {
            passed: output.status.success(),
            output: tail(&printed, OUTPUT_CHARS).to_owned(),
        })
    }
}

/// The last `chars` characters of `text`.
fn tail(text: &str, chars: usize) -> &str {
    let skip = text.chars().count().saturating_sub(chars);
    match text.char_indices().nth(skip) {
        Some((at, _)) => &text[at..],
        None => "",
    }
}
```

</details>

Дальше — [Инструменты](./tools): модель сама читает и меняет крейт.
