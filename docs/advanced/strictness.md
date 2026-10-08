---
sidebar_position: 1
title: Strict decoding and limits
description: What strict and lenient decoding accept, and the bounds every response is held to.
---

# Strict decoding and limits

Decoding is **strict by default**: anything svir does not know, or that does
not add up, is an error rather than a guess. Lenient decoding relaxes only what
cannot make the answer wrong.

```rust
use svir::prelude::*;

fn lenient() -> Result<Client, Error> {
    // For a server with extensions you do not need.
    Client::openai("http://127.0.0.1:1234").lenient().build()
}
```

`.lenient()` is shorthand for `.mode(svir::Mode::Lenient)`. The
[decoder](./codec#the-decoder) on its own takes the same choice:
`Decoder::strict()` or `Decoder::lenient()`.

## Strict and lenient

| The server sends | Strict | Lenient |
|---|---|---|
| A field svir does not know in a delta or a tool call | `Unsupported` | Skipped |
| An event type or SSE field outside the protocol | `Unsupported` | Skipped |
| Data that is not JSON, or invalid UTF-8 | `Protocol` | Skipped, or replaced lossily |
| A changing `id` or `model`, usage reported twice or incomplete | `Protocol` | Tolerated |
| More than one choice | `Unsupported` | The first is read |
| A finish reason svir does not know, or content after the finish reason | `Unsupported` | `Unsupported` |

Both modes enforce the [limits](#limits), fail a stream that ends early, and
refuse tool calls that are inconsistent: missing or duplicate IDs, a gap in
the indices, or a finish reason that disagrees with the calls.

A refusal, sent in `refusal` in place of `content`, is read in both modes: it
is the answer's text, and the finish is `Refusal`. An answer that is both
content and a refusal, or a refusal with tool calls, is `Protocol` in both.

Azure OpenAI's content filter sends chunks that carry nothing of the answer,
and both modes read them the same way:

- A prompt report (a chunk with no choices and `prompt_filter_results`, sent
  first) is skipped.
- An annotation from the asynchronous content filter (a choice with
  `content_filter_offsets` and no delta) is a verdict on text already
  streamed. One that blocks nothing is skipped, before the finish reason or
  after it. A block, a `content_filter` finish or a verdict marked
  `filtered: true`, makes the answer's finish `ContentFilter`, even after the
  model's own `stop`. Any other finish reason in an annotation is
  `Unsupported`.

### Which to choose

- **Strict** for a server under your control, and to find out what a new
  server actually sends.
- **Lenient** for a server with extensions you do not need, and for a
  [proxy](./proxy), where the downstream client is the judge of fields svir
  does not know.

Lenient is not a fix for an error you have not read. To see what a server
sends, run the `relay` example from the svir repository against it: it prints
the raw stream.

## Limits

Every response is bounded, in both modes. Reaching a bound is
`ErrorKind::ResponseLimit`, never a hang or an unbounded allocation.

| Limit | Method | Default |
|---|---|---|
| Bytes of the whole response, as they arrive | `wire_bytes(n)` | 64 MiB |
| Bytes of one server-sent event | `event_bytes(n)` | 256 KiB |
| Tool calls in one answer | `tool_calls(n)` | 64 |

```rust
use svir::Limits;
use svir::prelude::*;

fn tuned() -> Result<Client, Error> {
    let limits = Limits::default()
        .event_bytes(1024 * 1024)
        .tool_calls(16);

    Client::openai("http://127.0.0.1:1234").limits(limits).build()
}
```

The wire limit counts the event stream, which spends a few hundred bytes on
every token: 64 MiB is about a quarter of a million tokens. The decoder keeps
the answer, not the wire bytes, so the limit guards against a server that never
ends rather than against memory use.

## Inline `<think>` tags

Some servers leave a model's reasoning inside the answer text, between
`<think>` and `</think>`. By default svir splits it out into
`Event::Reasoning` with the source `Think`, even when a tag is cut in half by a
chunk boundary. To keep the text exactly as sent, tags included:

```rust
use svir::Think;
use svir::prelude::*;

fn keep_tags() -> Result<Client, Error> {
    Client::openai("http://127.0.0.1:1234").think(Think::Keep).build()
}
```
