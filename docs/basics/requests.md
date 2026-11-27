---
sidebar_position: 1
title: Requests
description: The system prompt, messages and their parts, reasoning effort, and sampling.
---

# Requests

A `Request` says what the model should answer: which model, the system prompt,
the conversation so far, the tools it may call, and a few parameters. It is
built with `Request::new(model)` and a chain of methods.

```rust
use svir::prelude::*;

fn request(question: &str) -> Request {
    Request::new("qwen3-27b")
        .system("Answer in one paragraph.")
        .reasoning(Effort::Low)
        .max_tokens(2048)
        .temperature(0.2)
        .user(question)
}
```

## The builder

Every method takes `self` and returns it, so a request is built as one chain,
or reassigned as it grows: `request = request.user(line);`. Calling a method
and dropping its result changes nothing.

| Method | Effect |
|---|---|
| `system(text)` | The system prompt. One per request; a second call replaces it |
| `user(text)` | Adds a user message with this text |
| `message(message)` | Adds a message built with [`Message`](#messages-and-parts) |
| `assistant(completion)` | Adds the model's answer, with its text, tool calls, and reasoning |
| `tool_result(call_id, content)` | Adds the result of one tool call |
| `tool_results(results)` | Adds results, one message each |
| `tool(tool)` / `tools(&toolbox)` | Describes tools the model may call; see [Tools](./tools) |
| `tool_choice(choice)` | Whether the model may or must call a tool; see [Tools](./tools#requiring-or-forbidding-a-call) |
| `response_format(format)` | The answer as JSON, or as JSON that matches a schema; see [Structured output](./structured-output) |
| `reasoning(effort)` | How much the model should reason |
| `max_tokens(n)` | The most tokens to generate. On most servers reasoning counts toward it. The Messages API requires it |
| `temperature(t)` | Sampling temperature |
| `include_usage(bool)` | Overrides the client's default (on) of asking for token counts. Chat Completions only: the Messages API always reports them |
| `send_reasoning(bool)` | Sends Chat Completions reasoning from earlier answers back (off by default). The Messages API always gets its own back |

Nothing is sent unless it is set: a request without `max_tokens` or
`temperature` leaves them to the server, and a tool choice or a response
format left at its default is not sent either. The one exception is
`max_tokens` for the Messages API, which requires it: a request without it is
`Unsupported` before anything is sent.

The fields are public for reading (`request.model`, `request.messages`), which
is what a [layer](../client/layers) uses. `Request` is `Clone`, and
serializable; see [Conversations](./conversations#storing-and-restoring).

:::info[The system prompt is a field, not a message]
`Role` is `User`, `Assistant`, or `Tool`. There is no system role: each wire
API puts the system prompt somewhere else, so it lives in `Request::system`
and the adapter places it.
:::

## Messages and parts

A `Message` is a role and its parts, in order. `request.user(text)` is a
shorthand for the common case; build a `Message` when a turn carries more than
text.

```rust
use svir::prelude::*;

fn compare() -> Request {
    let question = Message::user("What changed between these two?")
        .with(Image::path("before.png"))
        .with(Image::path("after.png"))
        .with(TextFile::path("diff.patch"));

    Request::new("qwen3-27b").message(question)
}
```

| Constructor | Use |
|---|---|
| `Message::user(text)` | A user turn. Empty text adds no part, so `Message::user("")` followed by images carries only the images |
| `Message::assistant(text)` | A model turn rebuilt from stored text. For a live answer use `request.assistant(done)` |
| `Message::tool_result(result)` | One tool result |
| `.with(part)` | Adds a part: a `&str`, a `String`, an `Image`, a `TextFile`, a `ToolCall`, a `ToolResult`, a `Reasoning` |

Which parts a role may carry is checked when the request is sent. A violation
is `ErrorKind::Unsupported`: nothing is dropped silently.

| Role | Parts |
|---|---|
| `User` | Text, images, text files |
| `Assistant` | Text, reasoning, tool calls |
| `Tool` | Tool results only |

Images and text files are covered in [Attachments](./attachments).

## Reasoning effort

`Effort` is `Off`, `Minimal`, `Low`, `Medium`, `High`, `XHigh`, or `Max`.
`Max` is as much as the model offers, and `XHigh` the level below it. Unset
sends nothing and leaves the choice to the server. `Off` asks for no
reasoning; whether the model obeys is up to the model. A level is sent as
set and never moved to one the server takes: which levels a model takes is
the model's.

| `Effort` | Chat Completions | Messages API |
|---|---|---|
| unset | nothing | nothing |
| `Off` | `reasoning_effort: "none"` | `thinking: {type: "disabled"}` |
| `Minimal` | `"minimal"` | `Unsupported`: the API has no such level |
| `Low` to `Max` | `"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"` | `thinking: {type: "adaptive", display: "summarized"}` and `output_config.effort` at that level |

On the Messages API a level turns adaptive thinking on, since some models do
not think unless asked, and asks for a summary of it, since some return
thinking blocks with empty text by default. Models that cannot turn thinking
off answer `Off` with a `400`.

```rust
use svir::prelude::*;

fn think_hard(question: &str) -> Request {
    Request::new("qwen3-27b")
        .reasoning(Effort::High)
        // Reasoning spends the output budget too; leave room for the answer.
        .max_tokens(8192)
        .user(question)
}
```

Some Chat Completions servers reject the `reasoning_effort` field outright. The
client handles that for you: the request is sent again without the field, once,
and the server is remembered. See
[compatibility handling](../client/configuration#compatibility-handling).

vLLM hands the effort to the model's chat template, which may name only some
of the values: Qwen3.8's rejects `High` with `400`. The request is then sent
without the optional fields, and the client stops sending them to that
server, usage included. Pick an effort the template names. Code that records
the effort it asked with can
[turn that off](../client/configuration#turning-it-off) and have the `400`,
whose message names the levels the template takes.

The reasoning itself comes back as `Event::Reasoning` while the answer streams,
and in `Completion::reasoning` at the end; see
[Reading an answer](./answers#reasoning).

## What a request cannot say

svir has no stop sequences, and asks for one choice. The response is always a
stream; `complete` collects it. If a server needs a field that is not in the
table above, svir does not carry it.
