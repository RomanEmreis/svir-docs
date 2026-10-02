import React from 'react';
import CodeBlock from '@theme-original/CodeBlock';
import type {Props} from '@theme/CodeBlock';

// Rust blocks get line numbers unless they say otherwise; a two-line shell
// command or a TOML table reads better without them.
export default function CodeBlockWrapper(props: Props) {
  const language = props.language ?? props.className?.match(/language-(\w+)/)?.[1];
  return <CodeBlock {...props} showLineNumbers={props.showLineNumbers ?? language === 'rust'} />;
}
