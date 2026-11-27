---
sidebar_position: 5
title: Слои и бюджет
description: Повторы и дедлайн вокруг каждого вызова, собственный слой, который считает токены, и бюджет, которого держится цикл.
---

# Слои и бюджет

Запуск может сделать много вызовов, и каждый стоит токенов. В этой главе
каждый вызов проходит через слои: дедлайн, повторы и собственный слой
программы, который считает, сколько взял каждый вызов, чтобы цикл мог
остановиться на бюджете.

## Повторы и дедлайн {/* #retries-and-a-deadline */}

Слои добавляются на билдере, вокруг каждого вызова, который делает клиент:

```rust skip
/// A client for the server `RALPH_API` names, with the layers every call goes through.
fn client(meter: &Meter) -> Result<Client, Failure> {
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

    let client = builder
        .layer(Timeout::total(Duration::from_secs(900)))
        .layer(Retry::transient(3).backoff(Duration::from_secs(1)))
        .layer(meter.clone())
        .build()?;

    Ok(client)
}
```

Первый добавленный слой — самый внешний: он первым видит запрос и последним —
ответ.

- **`Timeout::total`** даёт одному вызову пятнадцать минут, от запроса до
  последнего токена ответа, повторы включительно. Модель, которая пишет
  дольше, застряла в собственном цикле.
- **`Retry::transient(3)`** повторяет вызов ещё до трёх раз, если он упал до
  начала ответа: соединение отвергнуто, rate limit, ошибка сервера,
  перегруженный API. Он ждёт секунду, потом две, потом четыре — или столько,
  сколько попросил сервер. Когда ответ начался, ничего не повторяется: текст
  пришёл бы дважды.
- **Счётчик** — самый внутренний, поэтому видит каждую попытку, на которую
  пришёл ответ.

И без слоя клиент останавливает сервер, который молчит пять минут; см.
[Настройку](../client/configuration#timeouts).

## Слой, который считает токены {/* #a-layer-that-counts-tokens */}

Слой — это тип с одним методом, `call`. Он получает запрос и остаток стека,
`next`, и возвращает то, что вернул `next`, сделав своё:

```rust skip
/// Counts the tokens every call takes, the prompt and the answer.
#[derive(Clone, Default)]
struct Meter {
    spent: Arc<AtomicU64>,
}

impl Meter {
    fn spent(&self) -> u64 {
        self.spent.load(Ordering::Relaxed)
    }
}

impl Layer for Meter {
    async fn call(&self, request: Request, next: Next) -> Result<EventStream, Error> {
        let spent = self.spent.clone();
        let stream = next.run(request).await?;

        Ok(stream.inspect(move |item| {
            if let Ok(Event::Completed(done)) = item {
                let tokens = done.usage.map_or(0, |usage| usage.input + usage.output);
                spent.fetch_add(tokens, Ordering::Relaxed);
            }
        }))
    }
}
```

`next.run` возвращается, когда ответ начинается, а не когда заканчивается.
Расход токенов приходит с итоговым ответом, последним событием, поэтому
счётчик следит за потоком, который отдаёт: `inspect` видит каждый элемент по
пути к программе. Один клон счётчика держит клиент, другой — цикл, и оба
считают в один и тот же
[`Arc<AtomicU64>`](https://doc.rust-lang.org/book/ch16-03-shared-state.html).

`usage.input` — весь промпт этого вызова. В цикле с инструментами каждый вызов
отправляет весь диалог до него, так что вход растёт с каждым ходом; бюджет
считает его каждый раз, как и счёт.

Как написать слой замыканием и в каком порядке идут слои — в
[Слоях](../client/layers).

## Бюджет {/* #a-budget */}

Цикл проверяет счётчик перед каждым раундом:

```rust skip
let tests = workspace.test().await?;
let spent = meter.spent();
if tests.passed {
    println!("\n== the tests pass after {rounds} round(s) and {spent} tokens");
    return Ok(());
}
if rounds == ROUNDS {
    return Err(format!("the tests still fail after {ROUNDS} rounds").into());
}
if spent >= BUDGET {
    return Err(format!("{spent} tokens spent, and the budget is {BUDGET}").into());
}
```

а `round` — перед каждым вызовом:

```rust skip
for _ in 0..TURNS {
    if meter.spent() >= BUDGET {
        return Ok(());
    }
```

Уже сделанному вызову дают закончиться, так что запуск может превысить
`BUDGET` на один вызов; насколько — ограничивает `MAX_TOKENS`.

## Запустите {/* #run-it */}

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
== round 1, 0 tokens so far

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;

-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th
<- wrote src/lib.rs

-> write_file {"path":"NOTES.md","content":"# NOTES\n\n## Changed\n- `frequencies` in
-> run_tests {}
<- wrote NOTES.md
<- PASSED

-> write_file {"content":"# NOTES\n\n## Changed\n- `frequencies` in src/lib.rs now:\n
<- wrote NOTES.md
All 6 tests pass. The fix rewrote `frequencies` in src/lib.rs to lowercase the input, split on any whitespace, strip punctuation from each token (dropping empty ones), and sort by count descending with alphabetical tie-breaking — which matches exactly what the tests expect.

== the tests pass after 1 round(s) and 12614 tokens
```

Та же программа на Messages API в LM Studio — том эндпоинте, с которым
работает `Client::anthropic()`, — с той же моделью:

```bash
RALPH_API=anthropic RALPH_URL=http://127.0.0.1:1234 RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
== round 1, 0 tokens so far

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;

-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th
-> write_file {"path":"NOTES.md","content":"# Notes\n\n## Round 1\n\n- Crate: `frequen
<- wrote src/lib.rs
<- wrote NOTES.md

-> run_tests {}
<- PASSED
All 6 tests pass. Updating NOTES.md to close out.


-> write_file {"content":"# Notes\n\n## Round 1\n\n- Crate: `frequencies(text)` in `sr
<- wrote NOTES.md
Fixed. The original `frequencies` split only on single spaces, never lowercased, kept punctuation, and returned unsorted `HashMap` output. I rewrote it to use `split_whitespace()`, lowercase, strip non-alphanumeric characters (dropping tokens like `...` that empty out), and sort by count descending with alphabetical tie-breaking. All 6 tests pass, and NOTES.md is updated to reflect the fix and the completed state.

== the tests pass after 1 round(s) and 23449 tokens
```

<details>
<summary>Весь <code>src/main.rs</code></summary>

```rust
use std::{
    io::Write,
    path::{Component, Path, PathBuf},
    process::{ExitCode, Stdio},
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use schemars::JsonSchema;
use serde::Deserialize;
use svir::layer::{Layer, Next, Retry, Timeout};
use svir::prelude::*;
use tokio::process::Command;

/// What the model is asked to do, in every round.
const SYSTEM: &str = "You fix a Rust crate so that `cargo test` passes. \
    Read the files you need, change the code with write_file, and check it with run_tests. \
    Do not change the tests. Keep NOTES.md up to date as you go: what you changed, what you \
    learned, and what is left. A round can end at any time, and the next one starts from \
    those notes and nothing else.";

/// The file the model keeps its notes in, from one round to the next.
const NOTES: &str = "NOTES.md";

/// Rounds before the program gives up.
const ROUNDS: usize = 5;

/// Answers in one round before the round ends.
const TURNS: usize = 20;

/// Tokens one answer may take.
const MAX_TOKENS: u64 = 16_000;

/// Tokens all rounds together may take, prompts included.
const BUDGET: u64 = 500_000;

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
    let meter = Meter::default();
    let client = client(&meter)?;
    let tools = workspace.tools();

    let mut rounds = 0;
    loop {
        let tests = workspace.test().await?;
        let spent = meter.spent();
        if tests.passed {
            println!("\n== the tests pass after {rounds} round(s) and {spent} tokens");
            return Ok(());
        }
        if rounds == ROUNDS {
            return Err(format!("the tests still fail after {ROUNDS} rounds").into());
        }
        if spent >= BUDGET {
            return Err(format!("{spent} tokens spent, and the budget is {BUDGET}").into());
        }

        rounds += 1;
        println!("\n== round {rounds}, {spent} tokens so far");
        let notes = workspace.notes().await;
        let request = Request::new(&model)
            .system(SYSTEM)
            .max_tokens(MAX_TOKENS)
            .reasoning(Effort::Medium)
            .tools(&tools)
            .user(format!(
                "Your notes:\n\n{notes}\n\n`cargo test` prints:\n\n{}",
                tests.output
            ));
        round(&client, &tools, &meter, request).await?;
    }
}

/// A client for the server `RALPH_API` names, with the layers every call goes through.
fn client(meter: &Meter) -> Result<Client, Failure> {
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

    let client = builder
        .layer(Timeout::total(Duration::from_secs(900)))
        .layer(Retry::transient(3).backoff(Duration::from_secs(1)))
        .layer(meter.clone())
        .build()?;

    Ok(client)
}

/// One round: a fresh conversation that goes on while the model calls tools.
async fn round(
    client: &Client,
    tools: &Tools,
    meter: &Meter,
    mut request: Request,
) -> Result<(), Error> {
    for _ in 0..TURNS {
        if meter.spent() >= BUDGET {
            return Ok(());
        }

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

/// Counts the tokens every call takes, the prompt and the answer.
#[derive(Clone, Default)]
struct Meter {
    spent: Arc<AtomicU64>,
}

impl Meter {
    fn spent(&self) -> u64 {
        self.spent.load(Ordering::Relaxed)
    }
}

impl Layer for Meter {
    async fn call(&self, request: Request, next: Next) -> Result<EventStream, Error> {
        let spent = self.spent.clone();
        let stream = next.run(request).await?;

        Ok(stream.inspect(move |item| {
            if let Ok(Event::Completed(done)) = item {
                let tokens = done.usage.map_or(0, |usage| usage.input + usage.output);
                spent.fetch_add(tokens, Ordering::Relaxed);
            }
        }))
    }
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

    /// The notes the model left, or a word that there are none.
    async fn notes(&self) -> String {
        tokio::fs::read_to_string(self.root.join(NOTES))
            .await
            .unwrap_or_else(|_| "None: this is the first round.".to_owned())
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

## Что дальше {/* #where-to-go-from-here */}

- **Запускайте в песочнице.** Контейнер с примонтированным крейтом и без сети
  для тестов держит то, что пишет модель, подальше от вашей машины.
- **Коммитьте после каждого раунда.** `git commit` из цикла делает каждый
  раунд шагом, который можно посмотреть и откатить.
- **Дайте инструменты получше.** Инструмент поиска избавляет от чтения
  файлов целиком; инструмент, который запускает один тест, — от запуска всех.
- **Выполняйте вызовы одновременно.** `call_all` выполняет их один за другим;
  вызовы, которые только читают, можно выполнять разом в собственном
  [`Toolbox`](../basics/tools).
- **Следите за контекстом.** С заданным `context_tokens` клиент отвергает
  слишком большой для модели запрос ещё до отправки; см.
  [Допуск по контексту](../basics/attachments#context-admission).
