---
sidebar_position: 4
title: Раунды
description: Новый диалог в каждом раунде, заметки, которые переносят работу из одного в другой, и программа, а не модель, решает, когда работа сделана.
---

# Раунды

В этой главе программа запускает цикл с инструментами снова и снова, каждый
раз с новым диалогом, пока тесты не пройдут. То, что узнал один раунд,
попадает в следующий через файл.

## Зачем начинать заново {/* #why-start-over */}

Диалог только растёт. За каждый ответ платят всем диалогом до него, вместе с
прочитанными файлами и выводом тестов, а модель в глубине длинного контекста
теряет нить того, что делала. Работе, которая не помещается в один диалог,
нужен способ отложить её и подхватить снова.

Поэтому раунд, после которого тесты всё ещё падают, не продолжается.
Следующий начинается с того, что передал бы человек: задачи, собственных
заметок модели и того, что `cargo test` печатает сейчас.

## Заметки, которые переносятся {/* #notes-that-carry-over */}

Заметки просит системный промпт:

```rust skip
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
```

Модель пишет их тем же `write_file`, что у неё уже есть, и по ходу работы, а
не в конце: раунд может закончиться без предупреждения, когда кончились
`TURNS` или вызов обрезан, и заметки, отложенные на конец, пропали бы вместе
с ним. Программа читает их в начале каждого раунда:

```rust skip
/// The notes the model left, or a word that there are none.
async fn notes(&self) -> String {
    tokio::fs::read_to_string(self.root.join(NOTES))
        .await
        .unwrap_or_else(|_| "None: this is the first round.".to_owned())
}
```

Состояние хранится в крейте, а не в программе: код, который изменила модель,
и заметки, которые она оставила. Остановите программу — и следующий запуск
начнёт с того места, где остановился этот.

## Решает программа {/* #the-program-decides */}

`run` становится внешним циклом:

```rust skip
let mut rounds = 0;
loop {
    let tests = workspace.test().await?;
    if tests.passed {
        println!("\n== the tests pass after {rounds} round(s)");
        return Ok(());
    }
    if rounds == ROUNDS {
        return Err(format!("the tests still fail after {ROUNDS} rounds").into());
    }

    rounds += 1;
    println!("\n== round {rounds}");
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
    round(&client, &tools, request).await?;
}
```

- **Судья — тесты.** Модель, которая говорит «все тесты проходят», может
  ошибаться, поэтому программа запускает их сама, перед каждым раундом и
  после последнего.
- **Новый `Request` в каждом раунде.** В нём ничего нет от прошлого диалога,
  только заметки. Клиент тоже ничего не хранит между вызовами: сбрасывать
  нечего.
- **Как бы раунд ни закончился, дальше проверка.** Модель остановилась, вызов
  обрезан или кончились `TURNS`: `round` возвращается, и цикл смотрит на
  тесты.
- **Не больше `ROUNDS` раундов.** Модель, которая не может починить крейт,
  останавливают, и программа завершается с сообщением.

Оба цикла — ваши. svir отправляет запрос и возвращает ответ потоком; сколько
раз, с чем и когда остановиться — это вот эта функция.

## Запустите {/* #run-it */}

```bash
RALPH_MODEL=qwen/qwen3.8-27b cargo run -- ../wordfreq
```

```text
== round 1

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;
The issues are clear from the source and failures: single-space split, no punctuation stripping, no lowercasing, and no sorting. Let me fix it.


-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th
<- wrote src/lib.rs

-> write_file {"content":"# NOTES\n\n## Task\nMake `cargo test` pass for the word-freq
-> run_tests {}
<- wrote NOTES.md
<- PASSED
All 6 tests pass. Let me finalize the notes.


-> write_file {"content":"# NOTES\n\n## Task\nMake `cargo test` pass for the word-freq
<- wrote NOTES.md
The work is complete, but let me do a final verification of the current state.


-> read_file {"path":"src/lib.rs"}

-> run_tests {}
<- use std::collections::HashMap;
<- PASSED
All 6 tests pass and the source matches the fixed implementation. NOTES.md is current. Nothing is left to do — `cargo test` is green.

Summary of what was fixed in `src/lib.rs`:
- Split on any whitespace via `split_whitespace()`.
- Strip surrounding non-alphanumeric punctuation from each token.
- Lowercase words for case-insensitive counting.
- Drop tokens that become empty after trimming.
- Sort by count descending, then alphabetically for ties.

== the tests pass after 1 round(s)
```

Эта модель починила крейт за один раунд, записав заметки вместе с
исправлением, и дважды проверила работу, прежде чем остановиться.

## Раунд, оборванный на полпути {/* #a-round-cut-short */}

Чтобы увидеть, как раунд заканчивается раньше модели, задайте `TURNS` равным
3 и запустите программу на свежей копии `wordfreq`:

```text
== round 1

-> list_files {}
-> read_file {"path":"src/lib.rs"}
<- Cargo.lock
<- use std::collections::HashMap;
The current implementation only splits on a single space, doesn't lowercase, doesn't strip punctuation, and doesn't sort. Let me fix it.


-> write_file {"path":"src/lib.rs","content":"use std::collections::HashMap;\n\n/// Th

-> write_file {"path":"NOTES.md","content":"# Notes\n\n## What the crate does\n`freque
<- wrote src/lib.rs
<- wrote NOTES.md

-> run_tests {}
<- PASSED
-- 3 answers in this round; the round ends

== the tests pass after 1 round(s)
```

Раунду не хватило ответов сразу после `run_tests`, и модель не успела сказать,
что закончила. Собственная проверка программы нашла, что тесты проходят, так
что второго раунда не было. Если бы они падали, он начался бы с заметок,
которые модель записала вместе с исправлением:

```markdown title="NOTES.md"
# Notes

## What the crate does
`frequencies(text)` returns (word, count) pairs: most frequent first, ties in
alphabetical order, case-insensitive, punctuation stripped.

## What was wrong (initial state)
- Split only on a single space `' '` → `\t`, `\n` stayed attached.
- Kept original case (`River`/`river` counted separately).
- Kept punctuation (`hello?`, `(world)`, `...`).
- No sorting; relied on HashMap iteration order.
- Empty/whitespace tokens were counted as words.

## What I changed (this round)
- `src/lib.rs`: split with `split_whitespace()`, lowercase, keep only
  alphanumeric chars, skip empty tokens, then sort by count desc, word asc.
- Tests left untouched.

## What I learned
- Expected words are fully lowercase, so lowercasing before counting is what
  the tests want (e.g. `("river", 3)`).

## What is left
- Verify with `cargo test` (not yet run this round).
```

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

    let mut rounds = 0;
    loop {
        let tests = workspace.test().await?;
        if tests.passed {
            println!("\n== the tests pass after {rounds} round(s)");
            return Ok(());
        }
        if rounds == ROUNDS {
            return Err(format!("the tests still fail after {ROUNDS} rounds").into());
        }

        rounds += 1;
        println!("\n== round {rounds}");
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
        round(&client, &tools, request).await?;
    }
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

/// One round: a fresh conversation that goes on while the model calls tools.
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

Дальше — [Слои и бюджет](./layers): сколько может стоить запуск.
