---
sidebar_position: 3
title: Features and TLS
description: Cargo features, what each one turns on, and choosing a rustls crypto provider.
---

# Features and TLS

svir is one crate with no procedural macros. Its features decide how much of
it you build.

| Feature | Turns on | Default |
|---|---|---|
| `client` | `Client`, `EventStream`, the hyper transport, attachments read from disk | Yes |
| `tls` | HTTPS through rustls with the ring provider and the webpki roots | Yes |
| `tls-aws-lc` | HTTPS with the aws-lc-rs provider in place of ring | No |
| `schemars` | `Tools::add` and `Schema::of`, which derive a tool's input schema and an answer's schema from a type | No |
| `tracing` | The [`Trace` layer](./layers#trace) | No |

Reading a project's `Cargo.toml` tells you what it can use:

| What you find | What it means |
|---|---|
| `svir = "0.1"` and no `features` key | `client` and `tls`: everything except `Tools::add`, `Schema::of`, and `Trace` |
| `features = ["schemars"]` | `Tools::add` and `Schema::of`; the crate also needs `schemars = "1"` for the derive |
| `features = ["tracing"]` | The `Trace` layer |
| `default-features = false` | Types and the codec only: no `Client`, no `EventStream`, no layers, no attachments read from disk. See [The codec alone](../advanced/codec) |
| `default-features = false, features = ["client"]` | The client without HTTPS: an `https://` URL is a `Config` error at `build()` |
| `default-features = false, features = ["client", "tls-aws-lc"]` | HTTPS with aws-lc-rs instead of ring |

What else your crate needs, and when:

| For | Add |
|---|---|
| Any use of `Client` | `tokio` with a runtime; the client runs on Tokio |
| Typed tool arguments, `Completion::parse` | `serde` with `derive` |
| A tool schema written by hand | `serde_json` |
| `Tools::add`, `Schema::of` | `schemars = "1"` next to svir's `schemars` feature |
| A custom HTTP backend | `bytes` and `futures-core` |

## TLS and the crypto provider

HTTPS is rustls with the webpki roots and HTTP/2 by ALPN. The built-in
transport follows no redirects, uses no proxy, and trusts the default roots;
for anything else, see [Custom HTTP backend](./custom-backend).

The crypto provider is a feature:

| Feature | Provider |
|---|---|
| `tls` (default) | ring. Builds without a C toolchain everywhere |
| `tls-aws-lc` | aws-lc-rs. With both features on, this one is used |

svir always passes its provider to rustls explicitly, so it works with either.
The choice still matters to the rest of your build: rustls picks a
process-wide default provider only when exactly one is compiled in. If another
dependency brings aws-lc-rs (reqwest can), svir's default `tls` adds ring, and
code elsewhere that relies on the default (`ClientConfig::builder()`) panics
with "no process-level CryptoProvider available".

Take the provider the build already has:

```toml title="Cargo.toml"
[dependencies]
svir = { version = "0.1.5", default-features = false, features = ["client", "tls-aws-lc"] }
```

The other fix is in the code that relies on the default: pass a provider there
too, or install one at startup with `CryptoProvider::install_default`.

## Versions

This site describes svir **0.1.5**. Within 0.1, later releases are drop-in;
what earlier ones lack:

| Locked on | Missing |
|---|---|
| 0.1.0 | `Error::status()`, the `tls-aws-lc` feature, the 64 MiB default wire limit (it was 4 MiB), and the fix for inline `<think>` tags split across deltas |
| 0.1.1 | `FinishReason::ContentFilter` (a filtered answer was `Unsupported`), and Azure OpenAI streams in strict mode |
| 0.1.2 | `ErrorKind::ContentFilter` (a blocked prompt was `Unsupported`, and was sent twice), and Azure's asynchronous content filter (its annotations were `Unsupported`) |
| 0.1.3 | `ToolResult::error` and `is_error` (a failed call was `error: ` written into the content), `ClientBuilder::header`, and `TextFile::escaped_len` |
| 0.1.4 | `Request::tool_choice`, `Request::response_format` with `Schema`, `Completion::parse`, and `FinishReason::Refusal` (a refusal was `Unsupported` in strict mode, and dropped in lenient mode, which left no text) |

One change in 0.1.4 can show in code written for 0.1.3: a failure from
`Tools` is flagged with `is_error`, and its `content` no longer starts with
`error: `. What the model reads is the same.

One change in 0.1.5 can show in code written for 0.1.4: a refusal is read.
Strict mode failed it with `Unsupported`, and lenient mode completed with
`Stop` and no text. Now the refusal is the text and the finish is `Refusal`,
which a `match` written for 0.1.4 takes in its wildcard arm.

The [changelog](https://github.com/RomanEmreis/svir/blob/main/CHANGELOG.md)
has the details.
