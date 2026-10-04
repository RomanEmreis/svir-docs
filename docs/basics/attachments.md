---
sidebar_position: 2
title: Attachments
description: Images and text files, from disk or from memory, streamed into the request body.
---

# Attachments

A user message can carry images and text files next to its text. Attachments
given as paths are not read when the message is built: they are read while the
request is sent, a block at a time, so a large image is never in memory whole.

```rust
use svir::prelude::*;

fn attachments(photo: Vec<u8>) -> Message {
    Message::user("Describe what you see.")
        // A file: nothing is read until the request is sent.
        .with(Image::path("chart.png"))
        // An extension svir does not know needs its media type.
        .with(Image::path("scan.tif").media_type("image/tiff"))
        // Bytes already in memory always name theirs.
        .with(Image::bytes(photo, "image/jpeg"))
        // A text file, by path or from memory.
        .with(TextFile::path("notes.md"))
        .with(TextFile::text("query.sql", "select 1;"))
}
```

## Images

Images travel as base64 data URLs.

- The media type comes from the extension for `png`, `jpg`, `jpeg`, `gif`, and
  `webp`. Anything else needs `.media_type(..)`, or sending fails with
  `ErrorKind::Attachment`.
- `Image::bytes(data, media_type)` takes bytes already in memory, and always
  their media type.
- The model has to be able to see. A text-only model rejects the request or
  ignores the image; svir cannot tell which models can.

## Text files

Text files travel as text inside the message, wrapped with their name.

- They must be UTF-8. `TextFile` is for text: send an image as `Image`, and
  convert anything else first.
- The model is told the file name. `.name(..)` changes it, for example to hide
  a local path.
- `TextFile::text(name, text)` sends text from memory as if it were a file.

## When files are read

The encoder measures every file when the request is sent, so the body's exact
`Content-Length` is known before its first byte, and then streams the files
into the body.

- A file that is missing, unreadable, or changed since it was measured fails
  the **call** with `ErrorKind::Attachment`, not the construction of the
  message.
- Measuring a text file takes one read of the whole file, since its length
  once escaped into JSON depends on its contents. An image needs only its
  size. To skip that read, [declare the length](#declared-lengths).
- Paths are relative to the process's working directory.
- A file written to between measuring and sending fails rather than sending a
  body that disagrees with its length. A text file is checked to be UTF-8 as
  it streams, too.

:::tip
`ClientBuilder::context_tokens(n)` refuses a request that cannot fit before
sending it, by counting the body's bytes as tokens. That never underestimates
text, but it overestimates images by far: with image attachments, leave it off.
:::

## Declared lengths

An application that keeps files, a chat backend for one, can measure a text
file once, when it arrives, and store the length with it. Sending it then
reads nothing before the body streams: only the file's size is looked up.

```rust
use svir::prelude::*;

/// When the file arrives: its length once escaped into a JSON string.
fn measure(text: &[u8]) -> u64 {
    svir::body::escaped_len(text)
}

/// When it is sent: the stored length, so the file is read only once.
fn attach(path: &str, escaped: u64) -> TextFile {
    TextFile::path(path).escaped_len(escaped)
}
```

- `svir::body::escaped_len(bytes)` measures as svir escapes. Escaping works
  byte by byte, so the lengths of the pieces of a file add up to the length of
  the file, even a piece that ends inside a character: an upload can be
  measured as it arrives. It does not check that the bytes are UTF-8.
- A length the file cannot have, or one it turns out not to have while it
  streams, fails with `ErrorKind::Attachment`, and so does a file that is not
  UTF-8. No body goes out that disagrees with its `Content-Length`.
- Text in memory (`TextFile::text`) is measured anyway; a declared length
  that disagrees fails when the body is built.
- Images need no declaration: their base64 length follows from their size.
- `svir::body::escaped_len` needs no feature, so the code that stores files
  can measure them without the client.

## Stored attachments

A request can be serialized; see
[Conversations](./conversations#storing-and-restoring). An attachment given as
a path is stored as the path, and one given as bytes is stored as base64. A
declared escaped length is stored with its file. A stored path has to exist
again when the request is sent.
