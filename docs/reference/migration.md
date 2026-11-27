---
sidebar_position: 1
title: Migration
description: What to change when you upgrade svir, newest release first.
---

# Migration

The other pages describe svir **0.2** as it is. This one lists what changes
when you upgrade, newest release first. A release that asks nothing of you is
not here; every change, additions included, is in the
[changelog](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md).

Each release splits its changes in two:

- **Does not compile**: the compiler, or Cargo, finds every place. The fix is
  named.
- **Compiles, answers differently**: nothing flags these, so the entry says what
  to look for.

## 0.2.0

### Does not compile

- **The `tls` feature is now `tls-ring`.** Cargo stops at a manifest that names
  `tls`. Rename it:

  ```toml title="Cargo.toml"
  [dependencies]
  svir = { version = "0.2", features = ["tls-ring"] }
  ```

### Compiles, answers differently

- **The default features have no TLS.** A build on the default features that
  talks to an `https://` URL gets `ErrorKind::Config` from `build()`, with an
  error that names `tls-ring` and `tls-aws-lc`. Look for a svir dependency
  with no `features` key in a crate whose client talks to a hosted server, and
  add `features = ["tls-ring"]`. A build with
  `default-features = false, features = ["client", "tls-aws-lc"]` works as it
  was, and can become `features = ["tls-aws-lc"]`. See
  [Features and TLS](../client/features).
- **An image counts for 16384 tokens at most in context admission.** It
  counted as its base64 length. With `context_tokens` set, requests with
  large images that were refused are admitted now. For a model that charges
  less per image, set `image_tokens`; see
  [context admission](../basics/attachments#context-admission).
- **HTTP 529 is `ErrorKind::Transport`**, retryable. It was `Unsupported`. Code
  that treated a 529 as final retries it now, and so does `Retry::transient`.
- **A `400` that says the prompt is too long is `ContextOverflow`.** It was
  `Unsupported`.
- **`ClientBuilder::header` refuses `anthropic-version`**: svir writes it for
  the Messages API. A client that set it gets `Config` from `build()`.
- **Stored data reads as before.** `Reasoning::signature` and
  `Completion::parts` are new and absent from what 0.1 stored; they read back
  empty. A `match` on `ReasoningSource` takes the new `Thinking` and
  `RedactedThinking` in its wildcard arm.

## 0.1.7

### Compiles, answers differently

- **With a `Length` finish, `calls` is empty.** The calls the output limit cut
  off are in `cut_calls`, as `ToolCallDelta`s, never to run. Code that runs
  `calls` without checking the finish ran calls that may have been cut short;
  it runs nothing for such an answer now. Look for `done.calls` read before
  `done.finish`.
- **A cut call with no ID or no name is kept.** With a `Length` finish it was
  `ErrorKind::Protocol`, and the answer was lost with it; now the answer
  completes, and the call is in `cut_calls`.
- **`rustls` 0.23.46 and `tokio` 1.53.3 at the least.** A lockfile pinned
  below them takes them on `cargo update`.

## 0.1.6

### Compiles, answers differently

- **A call of a named tool that the server finishes with `stop` completes with
  `ToolCalls`**, as vLLM sends it. It failed with `Protocol`.
- **Reasoning sent under both `reasoning_content` and `reasoning` is one
  entry**, from `ReasoningSource::ReasoningContent`, as mlx-vlm sends it. It
  was two, and showed twice.
- **A server's message is read from `detail`** when its error body has no
  `error`, and a context overflow said there, or in words such as "context
  budget", is `ContextOverflow`. Both were `Unsupported` with no message.

## 0.1.5

### Compiles, answers differently

- **A refusal is read.** Strict mode failed it with `Unsupported`, and lenient
  mode completed with `Stop` and no text. Now the refusal is the text, and the
  finish is `FinishReason::Refusal`, which a `match` written before takes in
  its wildcard arm.

## 0.1.4

### Compiles, answers differently

- **A failed call from `Tools` is flagged with `is_error`**, and its `content`
  no longer starts with `error: `. What a Chat Completions model reads is the
  same. Code that looked for the prefix reads `is_error` instead.
- **A text file is checked to be UTF-8 while the body streams**, not only when
  it is measured: a file changed in between fails with `Attachment`.

## 0.1.3

### Compiles, answers differently

- **A prompt the content filter blocked is `ErrorKind::ContentFilter`**, and is
  sent once. It was `Unsupported`, after a second attempt that was billed
  again.
- **Azure's asynchronous content filter is read.** Its annotations were
  `Unsupported` in strict mode; a block now makes the finish
  `ContentFilter`, even after the whole answer streamed.

## 0.1.2

### Compiles, answers differently

- **A filtered answer finishes with `FinishReason::ContentFilter`.** It was
  `Unsupported`.
- **Lenient mode fails on an unknown finish reason and on content after the
  finish reason**, as strict mode does.

## 0.1.1

### Compiles, answers differently

- **The default wire limit is 64 MiB.** It was 4 MiB, and cut off long answers
  with `ResponseLimit`.
- **Inline `<think>` tags split across deltas are split out.** A delta that was
  only part of a tag left the tag in the answer text.
