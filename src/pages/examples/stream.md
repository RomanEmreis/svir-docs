```rust
use svir::prelude::*;

#[tokio::main]
async fn main() -> Result<(), Error> {
    let client = Client::openai("http://127.0.0.1:1234").build()?;
    let request = Request::new("qwen3-27b")
        .system("Be precise.")
        .user("Why do rivers meander?");

    let mut stream = client.stream(&request).await?;
    while let Some(event) = stream.next().await {
        match event? {
            Event::Text(piece) => print!("{piece}"),
            Event::Completed(done) => println!("\n{:?}", done.usage),
            _ => {}
        }
    }

    Ok(())
}
```
