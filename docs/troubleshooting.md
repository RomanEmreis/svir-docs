---
sidebar_position: 6
title: Troubleshooting
description: Symptom to cause, at runtime and at compile time.
---

# Troubleshooting

What a symptom usually means. For what each error kind is, see
[Errors](./errors).

## At runtime

### Building the client

| Symptom | Usual cause |
|---|---|
| `Config`: "plain HTTP to a host that is not loopback" | The URL is `http://` to another machine. Use `https://`, or `.allow_http()` for a trusted network |
| `Config`: "an https URL needs the `tls` or the `tls-aws-lc` feature" | `default-features = false` without either |
| `Config`: "the API key variable ... is not set" | `api_key_env` names a variable the process does not have. svir reads no `.env` file |
| `Config`: "http() must be called before layers are added" | Move `.http(backend)` above `.layer(..)` and `.wrap(..)` |
| `Config`: "a header name is not valid" | A name given to `.header(..)` has a space or another character a header name cannot have |
| `Config`: "the header ... is set by svir, not by the caller" | `.header(..)` named `authorization`, `content-type`, `content-length`, `accept`, `host`, `transfer-encoding`, or `connection`. The Bearer key goes through `api_key` |
| `Config`: "the value of header ... is not valid" | The value has a line break, another control character, or text that is not ASCII. Often a value read from a file with its trailing newline: trim it |
| A panic elsewhere: "no process-level CryptoProvider available" | Two rustls providers are compiled in: svir's `tls` brought ring next to another crate's aws-lc-rs. Take svir with `tls-aws-lc`; see [Features and TLS](./client/features#tls-and-the-crypto-provider) |

### Sending

| Symptom | Usual cause |
|---|---|
| `Transport`, and `is_unsent()` is true | Nothing listens at the URL: the server is not running, or the port is wrong |
| `Unsupported`, detail "HTTP 404" | The base URL points somewhere that is not the API (a path too many, a web UI), or the server does not know the model. `server_message()` usually says which |
| `Unsupported`, detail "HTTP 400" or "HTTP 422" | The server rejected the request. Read `server_message()`. Common: a model without tool or image support, or a message the server's chat template cannot take |
| `ContentFilter`, detail "HTTP 400" | Azure OpenAI's content filter blocked the prompt. Nothing was generated, but the evaluation was billed: change the prompt rather than send it again |
| `Unsupported`: "the response is not an event stream" | A success status with HTML or JSON: a gateway page, or an endpoint that ignores `stream` |
| `ContextOverflow` before anything was sent | `context_tokens` is set and the body's bytes plus `max_tokens` exceed it. Bytes overestimate images by far |
| `ContextOverflow` from the server | The conversation outgrew the context. Some servers say it inside a `200` stream; svir reports both the same way |
| `Attachment`: "an image has no media type" | An extension other than `png`, `jpg`, `jpeg`, `gif`, `webp`. Add `.media_type(..)` |
| `Attachment`: "a text file is not UTF-8" | `TextFile` is for text. Send an image as `Image`; convert anything else first |
| `Attachment`: "a text file is not the escaped length it declares" | `TextFile::escaped_len` declared a length the file cannot have, or one text in memory does not have. Measure the whole file with `svir::body::escaped_len` |
| `Attachment`: "an attachment changed after the body was built, or is not the length it declares" | The file was written to between measuring and sending, or its declared `escaped_len` is wrong |

### While the answer streams

| Symptom | Usual cause |
|---|---|
| `Unsupported`: "a delta field outside the protocol", or another "outside the protocol" | Strict decoding met something svir does not know. Read what the server sends (the `relay` example prints it); `.lenient()` skips such fields |
| `Unsupported`: "a finish reason outside the protocol" | The server stopped for a reason svir does not know (a filtered answer is `FinishReason::ContentFilter`, not this). Lenient mode does not change this |
| `Timeout`: "the server sent no response" or "the response stalled" | Silence for longer than the idle timeout (5 min by default). A local model on a long prompt can take longer; raise `idle_timeout` |
| `Timeout` from a `Timeout::first_token` layer on a local model | The deadline is shorter than the model needs to read the prompt |
| `TruncatedStream` | The connection was cut: a gateway's own timeout, or a server that crashed or unloaded the model |
| `ResponseLimit` | A response over 64 MiB, an event over 256 KiB, or more than 64 tool calls. Raise `Limits` if that is expected |

### The answer itself

| Symptom | Usual cause |
|---|---|
| `done.usage` is `None` | The server does not report usage, or it rejected the field and the client stopped asking |
| `done.text` starts with blank lines | The server left them after the reasoning. Trim for display |
| `done.text` is empty and `finish` is `Length` | Reasoning used the whole output budget. Raise `max_tokens`, or lower the effort |
| `done.text` is empty and `finish` is `ToolCalls` | Not a failure: the model is waiting for tool results |
| `finish` is `ContentFilter`, though the whole answer streamed | Azure's asynchronous content filter vets the answer after streaming it, and blocked part of it. Withdraw the text the user was shown |
| The model never calls a tool | The model has no tool support, or the description does not say when to use the tool |
| The next request after a tool call is rejected | The assistant turn or a result is missing: `request.assistant(done).tool_results(results)` |
| The same answer, whatever model is named | Some local servers answer with the loaded model when they do not know the ID. List the models |
| A request for one model is slow once, then fast | A local server loaded the model on the first request |

## At compile time

| The compiler says | Cause |
|---|---|
| No variant `System` on `Role` | The system prompt is `Request::system(..)` |
| Cannot create a non-exhaustive struct with a struct expression | Use the constructor: `Request::new`, `Tool::new`, `ToolResult::new`, `ToolResult::error`, `Usage::new` |
| Non-exhaustive patterns on `Event`, `ErrorKind`, `FinishReason`, `Part` | Add a wildcard arm |
| Use of moved value: `request` | The builder takes `self`. Write `request = request.user(..)`, and pass `&request` to `complete` and `stream` |
| No method `add` on `Tools` | Enable svir's `schemars` feature, or use `add_tool` with a schema |
| The trait `JsonSchema` is not implemented | Your `schemars` is not version 1, so its derive is a different trait |
| Cannot find `Trace` in `svir::layer` | Enable the `tracing` feature |
| Cannot find `Client` in `svir` | `default-features = false` turned the `client` feature off |
| `Layer`, `Next`, `Retry`, or `Decoder` not found | They are not in the prelude: `svir::layer::..`, `svir::openai::chat::..` |
| Mismatched types: expected `Client<..>`, found `Client` | A client with a custom backend is `Client<Backend>`; name the type, or be generic over `B: svir::http::Backend` |
| A future is not `Send`, in a `Layer` or `Toolbox` impl | Something that is not `Send` (an `Rc`, a `std::sync::MutexGuard`) is held across an `.await` |
| Expected `ToolResult`, found `Result<..>` in `Toolbox::call` | `call` returns a result for the model, never an error: turn the failure into `ToolResult::error(&call.id, message)` |
