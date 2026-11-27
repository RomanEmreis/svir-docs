---
sidebar_position: 3
title: Инструменты
description: Четыре инструмента в рабочей области, из которой модели не выйти, цикл с инструментами, вызовы по мере прихода и вызовы, которые оборвал лимит вывода.
---

# Инструменты

В этой главе модель перестаёт объяснять и начинает работать: она получает
инструменты, чтобы смотреть, читать и записывать файлы крейта и запускать его
тесты, а программа выполняет её вызовы, пока она их делает.

## Путь, который называет модель {/* #a-path-the-model-names */}

Каждый путь приходит от модели, поэтому рабочая область проверяет его, прежде
чем использовать:

```rust skip
/// A path the model named, if it stays inside the workspace.
fn path(&self, relative: &str) -> std::io::Result<PathBuf> {
    let inside = Path::new(relative)
        .components()
        .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
    if !inside {
        let error = format!("{relative} is outside the crate");
        return Err(std::io::Error::other(error));
    }

    Ok(self.root.join(relative))
}
```

Путь только из имён и `.` не может выйти за пределы крейта: `..`, `/etc` и
`C:\` отвергаются. Проверка читает путь, а не диск, так что символическая
ссылка внутри крейта всё же может вести наружу. В учебном крейте таких нет.

## Четыре инструмента {/* #four-tools */}

То, что принимает инструмент, — это тип, и модель видит его схему:

```rust skip
/// The arguments of a tool that takes none.
#[derive(Deserialize)]
struct Nothing {}

#[derive(Deserialize, JsonSchema)]
struct ReadFile {
    /// The file's path from the crate's root, such as `src/lib.rs`.
    path: String,
}

#[derive(Deserialize, JsonSchema)]
struct WriteFile {
    /// The file's path from the crate's root.
    path: String,
    /// The whole new content of the file.
    content: String,
}
```

Реестр связывает каждый инструмент с обработчиком:

```rust skip
/// The tools the model works with, each answering on a clone of the workspace.
fn tools(&self) -> Tools {
    let (list, read, write, test) = (self.clone(), self.clone(), self.clone(), self.clone());
    // A tool that takes no arguments keeps the empty schema `Tool::new` gives it.
    let list_files = Tool::new("list_files", "List the files of the crate.");
    let run_tests = Tool::new("run_tests", "Run `cargo test` and read what it printed.");

    Tools::new()
        .add_tool(list_files, move |_: Nothing| list.clone().list_files())
        .add("read_file", "Read a file of the crate.", move |args| {
            read.clone().read_file(args)
        })
        .add("write_file", "Write a file of the crate.", move |args| {
            write.clone().write_file(args)
        })
        .add_tool(run_tests, move |_: Nothing| test.clone().run_tests())
}
```

- **`add`** выводит схему из типа аргументов обработчика. Doc-комментарии
  его полей становятся их описаниями, и модель их читает.
- **`add_tool`** принимает `Tool`, описанный вами. Им пользуется инструмент
  без аргументов: `Tool::new` даёт схему пустого объекта с пустым
  `properties`, а некоторые серверы, и LM Studio среди них, отвергают схему
  объекта совсем без `properties` — а именно такова выведенная схема пустой
  структуры.
- **Обработчик** — замыкание, которое принимает аргументы и возвращает
  future. Он живёт столько же, сколько реестр, поэтому владеет тем, чем
  пользуется: каждый держит клон рабочей области и клонирует её снова для
  каждого вызова.
- **Аргументы, которые не подходят к типу, до обработчика не доходят.**
  Модели сообщают, что они неверны, и она может попробовать снова.

Обработчики — это методы рабочей области:

```rust skip
async fn list_files(self) -> std::io::Result<String> {
    let mut files = Vec::new();
    let mut dirs = vec![PathBuf::new()];
    while let Some(dir) = dirs.pop() {
        let mut entries = tokio::fs::read_dir(self.root.join(&dir)).await?;
        while let Some(entry) = entries.next_entry().await? {
            let name = entry.file_name();
            if name == "target" || name.to_string_lossy().starts_with('.') {
                continue;
            }

            let path = dir.join(name);
            if entry.file_type().await?.is_dir() {
                dirs.push(path);
            } else {
                files.push(path.display().to_string());
            }
        }
    }

    files.sort();
    Ok(files.join("\n"))
}

async fn read_file(self, args: ReadFile) -> std::io::Result<String> {
    tokio::fs::read_to_string(self.path(&args.path)?).await
}

async fn write_file(self, args: WriteFile) -> std::io::Result<String> {
    let path = self.path(&args.path)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    tokio::fs::write(&path, &args.content).await?;

    Ok(format!("wrote {}", args.path))
}

async fn run_tests(self) -> std::io::Result<String> {
    let tests = self.test().await?;
    let verdict = if tests.passed { "PASSED" } else { "FAILED" };

    Ok(format!("{verdict}\n{}", tests.output))
}
```

Обработчик возвращает `Result`. Его `Ok` — то, что прочтёт модель; его `Err`
сообщается модели как неудачный результат с флагом `is_error`. Несуществующий
файл или путь за пределами крейта — то, что модель прочтёт и обойдёт, а не
конец программы.

## Цикл с инструментами {/* #the-tool-loop */}

Теперь у запроса есть системный промпт, глубина рассуждений и инструменты:

```rust skip
let request = Request::new(&model)
    .system(SYSTEM)
    .max_tokens(MAX_TOKENS)
    .reasoning(Effort::Medium)
    .tools(&tools)
    .user(format!("`cargo test` prints:\n\n{}", tests.output));
round(&client, &tools, request).await?;
```

`round` выполняет цикл, который возвращает модели результаты. Своего такого
цикла у svir нет: здесь это несколько строк, и когда ему закончиться, решаете
вы.

```rust skip
/// One round: a conversation that goes on while the model calls tools.
async fn round(client: &Client, tools: &Tools, mut request: Request) -> Result<(), Error> {
    for _ in 0..TURNS {
        let done = show(client.stream(&request).await?).await?;
        if !done.cut_calls.is_empty() {
            println!("-- the output limit cut a call short; the round ends");
            return Ok(());
        }
        if done.calls.is_empty() {
            return Ok(());
        }

        let results = tools.call_all(&done.calls).await;
        for result in &results {
            let first = result.content.lines().next().unwrap_or_default();
            println!("<- {}", clip(first, SHOWN_CHARS));
        }
        request = request.assistant(done).tool_results(results);
    }

    println!("-- {TURNS} answers in this round; the round ends");
    Ok(())
}
```

- **В ответе есть вызовы: выполнить их и отправить обратно ответ и
  результаты.** `call_all` выполняет их один за другим.
  `request.assistant(done)` добавляет ответ модели в диалог таким, каким он
  пришёл, а `tool_results` — то, что вернул каждый вызов. Запрос — это
  диалог, так что он прирастает и тем и другим.
- **Вызовов нет: модель закончила**, а с ней и раунд.
- **Обрезанные вызовы.** Ответ, который упёрся в `MAX_TOKENS`, пока писал
  вызов, завершается с `Length`. Его `calls` пуст, а начатые вызовы лежат в
  `cut_calls` и не для выполнения: их аргументы неполны. Раунд
  заканчивается; если это случается часто, увеличьте `MAX_TOKENS`.
- **Не больше `TURNS` ответов.** Иначе модель, которая не перестаёт вызывать
  инструменты, работала бы вечно.

`Effort::Medium` просит модель рассуждать, прежде чем ответить. В Messages
API это адаптивные рассуждения, и блоки рассуждений уходят обратно вместе с
ответом, подписанные и на своём месте, через `request.assistant(done)`:
циклу больше ничего не нужно. См. [Anthropic Messages](../client/anthropic#thinking).

## Вызовы по мере прихода {/* #calls-as-they-stream */}

Вызов приходит кусками, сначала имя, потом аргументы, и теперь `show`
печатает начало каждого:

```rust skip
/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    let mut shown = 0;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
            }
            // A call streams too, though it runs only once it is complete. Only its start is
            // shown: a file the model writes can be long.
            Event::ToolCallDelta(piece) => {
                if let Some(name) = piece.name {
                    print!("\n-> {name} ");
                    shown = 0;
                }
                let room = SHOWN_CHARS.saturating_sub(shown);
                print!("{}", clip(&piece.arguments, room));
                shown += piece.arguments.chars().count();
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

`ToolCallDelta` — только для показа. Вызовы для выполнения лежат в итоговом
ответе, целые и проверенные; см. [Инструменты](../basics/tools).

## Запустите {/* #run-it */}

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
-> read_file {"path":"src/lib.rs"}
<- use std::collections::HashMap;

-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th
<- wrote src/lib.rs

-> run_tests {}
<- PASSED
All 6 tests pass. The fixes to `frequencies`:

- **Any whitespace**: use `split_whitespace()` instead of `split(' ')`.
- **Punctuation**: strip non-alphabetic characters from each token, and skip tokens that are purely punctuation/empty.
- **Case insensitivity**: lowercase each word before counting.
- **Ordering**: sort by count descending, then alphabetically for ties (the old code returned unsorted `HashMap` order).

== the tests pass
```

`->` — вызов по мере прихода, `<-` — первая строка того, что он вернул. В
`wordfreq` команда `git diff` покажет, что изменила модель.

<details>
<summary>Весь <code>src/main.rs</code></summary>

```rust
use std::{
    io::Write,
    path::{Component, Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::Arc,
    time::Duration,
};

use schemars::JsonSchema;
use serde::Deserialize;
use svir::prelude::*;
use tokio::process::Command;

/// What the model is asked to do.
const SYSTEM: &str = "You fix a Rust crate so that `cargo test` passes. \
    Read the files you need, change the code with write_file, and check it with run_tests. \
    Do not change the tests.";

/// Answers in one round before the round ends.
const TURNS: usize = 20;

/// Tokens one answer may take.
const MAX_TOKENS: u64 = 16_000;

/// How much of the test output the model sees, from the end.
const OUTPUT_CHARS: usize = 6_000;

/// How much of a call's arguments, or of its result, is shown.
const SHOWN_CHARS: usize = 72;

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
    let tools = workspace.tools();

    let tests = workspace.test().await?;
    if tests.passed {
        println!("the tests pass");
        return Ok(());
    }

    let request = Request::new(&model)
        .system(SYSTEM)
        .max_tokens(MAX_TOKENS)
        .reasoning(Effort::Medium)
        .tools(&tools)
        .user(format!("`cargo test` prints:\n\n{}", tests.output));
    round(&client, &tools, request).await?;

    let tests = workspace.test().await?;
    let verdict = if tests.passed { "pass" } else { "still fail" };
    println!("\n== the tests {verdict}");

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

/// One round: a conversation that goes on while the model calls tools.
async fn round(client: &Client, tools: &Tools, mut request: Request) -> Result<(), Error> {
    for _ in 0..TURNS {
        let done = show(client.stream(&request).await?).await?;
        if !done.cut_calls.is_empty() {
            println!("-- the output limit cut a call short; the round ends");
            return Ok(());
        }
        if done.calls.is_empty() {
            return Ok(());
        }

        let results = tools.call_all(&done.calls).await;
        for result in &results {
            let first = result.content.lines().next().unwrap_or_default();
            println!("<- {}", clip(first, SHOWN_CHARS));
        }
        request = request.assistant(done).tool_results(results);
    }

    println!("-- {TURNS} answers in this round; the round ends");
    Ok(())
}

/// Shows an answer as it streams, and returns it once it is complete.
async fn show(mut stream: EventStream) -> Result<Completion, Error> {
    let mut started = false;
    let mut shown = 0;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) if started => print!("{piece}"),
            // Many models open with blank lines: the text starts at its first letter.
            Event::Text(piece) => {
                let piece = piece.trim_start();
                started = !piece.is_empty();
                print!("{piece}");
            }
            // A call streams too, though it runs only once it is complete. Only its start is
            // shown: a file the model writes can be long.
            Event::ToolCallDelta(piece) => {
                if let Some(name) = piece.name {
                    print!("\n-> {name} ");
                    shown = 0;
                }
                let room = SHOWN_CHARS.saturating_sub(shown);
                print!("{}", clip(&piece.arguments, room));
                shown += piece.arguments.chars().count();
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

/// The crate the model works on. Every path it names stays inside.
#[derive(Clone)]
struct Workspace {
    root: Arc<Path>,
}

/// What `cargo test` said.
struct Tests {
    passed: bool,
    output: String,
}

/// The arguments of a tool that takes none.
#[derive(Deserialize)]
struct Nothing {}

#[derive(Deserialize, JsonSchema)]
struct ReadFile {
    /// The file's path from the crate's root, such as `src/lib.rs`.
    path: String,
}

#[derive(Deserialize, JsonSchema)]
struct WriteFile {
    /// The file's path from the crate's root.
    path: String,
    /// The whole new content of the file.
    content: String,
}

impl Workspace {
    fn new(root: impl Into<PathBuf>) -> Self {
        Self {
            root: Arc::from(root.into()),
        }
    }

    /// The tools the model works with, each answering on a clone of the workspace.
    fn tools(&self) -> Tools {
        let (list, read, write, test) = (self.clone(), self.clone(), self.clone(), self.clone());
        // A tool that takes no arguments keeps the empty schema `Tool::new` gives it.
        let list_files = Tool::new("list_files", "List the files of the crate.");
        let run_tests = Tool::new("run_tests", "Run `cargo test` and read what it printed.");

        Tools::new()
            .add_tool(list_files, move |_: Nothing| list.clone().list_files())
            .add("read_file", "Read a file of the crate.", move |args| {
                read.clone().read_file(args)
            })
            .add("write_file", "Write a file of the crate.", move |args| {
                write.clone().write_file(args)
            })
            .add_tool(run_tests, move |_: Nothing| test.clone().run_tests())
    }

    /// A path the model named, if it stays inside the workspace.
    fn path(&self, relative: &str) -> std::io::Result<PathBuf> {
        let inside = Path::new(relative)
            .components()
            .all(|part| matches!(part, Component::Normal(_) | Component::CurDir));
        if !inside {
            let error = format!("{relative} is outside the crate");
            return Err(std::io::Error::other(error));
        }

        Ok(self.root.join(relative))
    }

    async fn list_files(self) -> std::io::Result<String> {
        let mut files = Vec::new();
        let mut dirs = vec![PathBuf::new()];
        while let Some(dir) = dirs.pop() {
            let mut entries = tokio::fs::read_dir(self.root.join(&dir)).await?;
            while let Some(entry) = entries.next_entry().await? {
                let name = entry.file_name();
                if name == "target" || name.to_string_lossy().starts_with('.') {
                    continue;
                }

                let path = dir.join(name);
                if entry.file_type().await?.is_dir() {
                    dirs.push(path);
                } else {
                    files.push(path.display().to_string());
                }
            }
        }

        files.sort();
        Ok(files.join("\n"))
    }

    async fn read_file(self, args: ReadFile) -> std::io::Result<String> {
        tokio::fs::read_to_string(self.path(&args.path)?).await
    }

    async fn write_file(self, args: WriteFile) -> std::io::Result<String> {
        let path = self.path(&args.path)?;
        if let Some(parent) = path.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        tokio::fs::write(&path, &args.content).await?;

        Ok(format!("wrote {}", args.path))
    }

    async fn run_tests(self) -> std::io::Result<String> {
        let tests = self.test().await?;
        let verdict = if tests.passed { "PASSED" } else { "FAILED" };

        Ok(format!("{verdict}\n{}", tests.output))
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

/// The first `chars` characters of `text`.
fn clip(text: &str, chars: usize) -> &str {
    match text.char_indices().nth(chars) {
        Some((at, _)) => &text[..at],
        None => text,
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

Дальше — [Раунды](./rounds): когда одного диалога мало.
