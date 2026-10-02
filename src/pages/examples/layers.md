```rust
use std::time::Duration;

use svir::layer::{Retry, Timeout, Trace};
use svir::prelude::*;

fn client() -> Result<Client, Error> {
    Client::openai("https://models.example.com/v1")
        .api_key_env("MODELS_API_KEY")
        .layer(Retry::transient(3).backoff(Duration::from_millis(250)))
        .layer(Timeout::first_token(Duration::from_secs(60)))
        .layer(Trace)
        .wrap(|request, next| async move {
            eprintln!("asking {}", request.model);
            next.run(request).await
        })
        .build()
}
```
