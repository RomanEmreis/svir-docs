---
sidebar_position: 1
title: Цикл, который чинит тесты
sidebar_label: Обзор
description: Что строит туториал, как это устроено и что нужно до начала.
---

# Туториал: цикл, который чинит тесты

Этот туториал строит `ralph` — программу командной строки, которая добивается,
чтобы падающий `cargo test` прошёл. Она даёт модели инструменты, чтобы читать
и записывать файлы крейта и запускать его тесты, и даёт ей работать. Когда
модель останавливается, программа сама запускает тесты. Если они всё ещё
падают, она запускает модель заново, с новым диалогом, и переносится только
код и файл заметок, который ведёт модель. Программа останавливается, когда
тесты проходят или когда исчерпаны раунды или бюджет токенов.

Такой цикл иногда называют Ralph loop: один и тот же промпт, снова и снова,
с чистым контекстом, а состояние хранится в файлах, а не в диалоге. Он
подходит для работы, которую может проверить программа, — например, тесты,
которые проходят или падают, — и которой может не хватить одного диалога.

Каждая глава дополняет одну и ту же программу и заканчивается целым
`src/main.rs`, так что остановиться можно после любой главы — с программой,
которая работает.

Туториал написан для разработчиков, которые немного знают Rust и, возможно,
работали с LLM SDK на другом языке. Самому Rust он не учит: где коду нужна
возможность языка, текст называет её и даёт ссылку на
[Rust Book](https://doc.rust-lang.org/book/).

## Как это устроено {/* #how-it-works */}

```text
round, until the tests pass or ROUNDS or BUDGET is spent:
    cargo test                                   the program runs it, and decides
    a new request: the task, NOTES.md, the test output
    turn, until the model stops calling tools or TURNS is spent:
        stream the answer
        run its calls: list_files, read_file, write_file, run_tests
        send the answer and the results back
```

Оба цикла — код программы. svir отправляет запрос и возвращает ответ потоком;
у него нет агентского цикла, и диалог он не хранит. Поэтому программа сама
решает, что такое раунд, что переносится дальше и сколько может стоить запуск.

1. **[Проект и первый вызов](./first-call):** клиент для OpenAI-совместимого
   сервера или Anthropic Messages API, выбранный при запуске программы, и
   ответ о падающих тестах, потоком.
2. **[Инструменты](./tools):** четыре инструмента в рабочей области, из
   которой модели не выйти, цикл с инструментами, вызовы, показанные по мере
   прихода, и вызовы, которые оборвал лимит вывода.
3. **[Раунды](./rounds):** новый диалог в каждом раунде, заметки, которые
   переносят работу дальше, и программа, а не модель, решает, когда работа
   сделана.
4. **[Слои и бюджет](./layers):** повторы и дедлайн вокруг каждого вызова,
   слой, который считает токены, и бюджет, которого держится цикл.

## До начала {/* #before-you-start */}

- **Rust 1.85 или новее.** Установите его через [rustup](https://rustup.rs/).
- **Модель, которая хорошо вызывает инструменты.** Вывод на этих страницах
  получен от LM Studio, который отдаёт `qwen/qwen3.8-27b` по адресу
  `http://127.0.0.1:1234` — этот адрес программа использует, если не сказано
  иное. Подойдёт и хостинговая модель: OpenAI-совместимый API или Anthropic
  API.
- **Крейт с падающими тестами.** В учебном крейте ниже их шесть.

:::warning[Он запускает код, написанный моделью]
`ralph` запускает `cargo test` на том, что написала модель, а тест или
скрипт сборки может сделать всё, что можете вы. Запускайте его на копии
крейта, в контейнере или одноразовом клоне, и прочтите diff, прежде чем
оставить изменения.
:::

## Учебный крейт {/* #the-practice-crate */}

```bash
cargo new --lib wordfreq
```

Замените `wordfreq/src/lib.rs` функцией, которая делает не то, что говорит её
документация, и тестами, которые это показывают:

```rust
use std::collections::HashMap;

/// The words of `text` and how often each occurs, the most frequent first.
///
/// Words are compared without regard to case, and the punctuation around a word
/// is not part of it. Words that occur equally often are in alphabetical order.
pub fn frequencies(text: &str) -> Vec<(String, usize)> {
    let mut counts = HashMap::new();
    for word in text.split(' ') {
        *counts.entry(word.to_string()).or_insert(0) += 1;
    }

    counts.into_iter().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn counts(pairs: &[(&str, usize)]) -> Vec<(String, usize)> {
        pairs.iter().map(|&(word, n)| (word.to_string(), n)).collect()
    }

    #[test]
    fn most_frequent_first() {
        assert_eq!(frequencies("a b a"), counts(&[("a", 2), ("b", 1)]));
    }

    #[test]
    fn case_does_not_matter() {
        assert_eq!(frequencies("River river RIVER"), counts(&[("river", 3)]));
    }

    #[test]
    fn punctuation_is_not_part_of_a_word() {
        let text = "Hello, world! Hello... (world) hello?";
        assert_eq!(frequencies(text), counts(&[("hello", 3), ("world", 2)]));
    }

    #[test]
    fn ties_in_alphabetical_order() {
        assert_eq!(frequencies("c a b"), counts(&[("a", 1), ("b", 1), ("c", 1)]));
    }

    #[test]
    fn any_whitespace_separates_words() {
        let text = "one\ttwo\n  two   ";
        assert_eq!(frequencies(text), counts(&[("two", 2), ("one", 1)]));
    }

    #[test]
    fn no_words() {
        assert_eq!(frequencies(" ... "), counts(&[]));
    }
}
```

Закоммитьте его, чтобы `git diff` потом показал, что изменила модель:

```bash
cd wordfreq
git add -A && git commit -m "Failing tests"
cargo test
```

Шесть тестов падают. Начните с [Проекта и первого вызова](./first-call).
