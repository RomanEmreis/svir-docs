# Migration

What changes between svir releases: for a project locked on an older one, and
for an upgrade. The rest of this skill describes svir 0.2.

## Contents

- [A project on an older release](#a-project-on-an-older-release)
- [Upgrading to 0.2](#upgrading-to-02)
- [Upgrading within 0.1](#upgrading-within-01)

## A project on an older release

Read `Cargo.lock` for the version. What each release lacks against the one
after it:

| Locked on | What it lacks, or does differently |
|---|---|
| 0.1.x | No Messages API (`Client::anthropic`, `svir::anthropic`), no `Reasoning::signature`, no `Completion::parts`, no `image_tokens`, no `ClientBuilder::base_url`. TLS is the `tls` feature, on by default; `tls-ring` does not exist. An image counts as all its bytes in `context_tokens`. A 529 is `Unsupported` |
| 0.1.6 | No `Effort::Minimal` or `Effort::Max`, no `Completion::cut_calls`, no `ClientBuilder::lean_retry`. With a `Length` finish, calls the output limit may have cut short are in `calls`: check the finish before running them. A call with no ID or no name in such an answer fails with `Protocol` |
| 0.1.5 | Reasoning that mlx-vlm sends under both `reasoning_content` and `reasoning` arrives twice. A call of a named tool that vLLM finishes with `stop` fails with `Protocol`. An error in FastAPI's form, `{"detail": ...}`, has no `server_message()` |
| 0.1.4 | No `tool_choice`, no `response_format`, no `Schema`, no `Completion::parse`, no `FinishReason::Refusal`: a refusal fails strict decoding with `Unsupported`, and lenient decoding completes with `Stop` and no text |
| 0.1.3 | No `ToolResult::error`, no `is_error`: a failed call's content starts with `error: `, which `Tools` writes too. No `ClientBuilder::header`, no `TextFile::escaped_len` |
| 0.1.2 | No `ErrorKind::ContentFilter`: a blocked prompt is `Unsupported`, and is sent a second time. Azure's asynchronous content filter fails the stream with `Unsupported` |
| 0.1.1 | No `FinishReason::ContentFilter`: a filtered answer is `Unsupported`. Azure OpenAI streams fail in strict mode |
| 0.1.0 | No `Error::status()`, no `tls-aws-lc`, a 4 MiB default wire limit, and inline `<think>` tags left in the text when a delta is only part of a tag |

Do not write code for a newer API against an older lock file: say what the
project would need, or run `cargo update -p svir` within 0.1, which is
drop-in but for the behavior changes below.

## Upgrading to 0.2

**Does not compile:**

- The `tls` feature is `tls-ring`. Cargo stops at a manifest that names
  `tls`: rename it.

**Compiles, answers differently:**

- The default features have no TLS. A crate on the default features that
  talks to an `https://` URL gets `Config` from `build()`: add
  `features = ["tls-ring"]`. `default-features = false, features =
  ["client", "tls-aws-lc"]` works as it was, and can become
  `features = ["tls-aws-lc"]`.
- An image counts for at most `image_tokens` (16384) in `context_tokens`:
  requests with large images that were refused are admitted now.
- HTTP 529 is `Transport`, retryable, where it was `Unsupported`.
- A 400 that says the prompt is too long is `ContextOverflow`, where it was
  `Unsupported`.
- `.header("anthropic-version", ..)` is a `Config` error.
- Stored completions and requests read as before: `signature` and `parts` are
  absent from 0.1 data and read back empty.

## Upgrading within 0.1

Each 0.1 release is drop-in for code, with these changes in behavior:

- **0.1.7**: with a `Length` finish, `calls` is empty and the calls are in
  `cut_calls`; a cut call with no ID or no name is kept, where it was
  `Protocol`. Needs `rustls` 0.23.46 and `tokio` 1.53.3.
- **0.1.6**: a named tool's call finished with `stop` completes with
  `ToolCalls`; mlx-vlm's reasoning under both keys is one entry; a `detail`
  body gives `server_message()`, and an overflow said there is
  `ContextOverflow`.
- **0.1.5**: a refusal is read: the finish is `Refusal`, and the refusal is
  the text.
- **0.1.4**: a `Tools` failure is `is_error`, and its content no longer starts
  with `error: `; test `result.is_error`.
- **0.1.3**: a blocked prompt is `ContentFilter`, sent once; Azure's
  asynchronous filter is read.
- **0.1.2**: a filtered answer finishes with `ContentFilter`.
- **0.1.1**: the default wire limit is 64 MiB; `<think>` tags split across
  deltas are split out.
