import {useState, type ComponentType, type ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import Translate, {translate} from '@docusaurus/Translate';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';
import MDXContent from '@theme/MDXContent';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Logo from '@site/static/img/logo.svg';

import StreamExample from './examples/stream.md';
import ToolsExample from './examples/tools.md';
import LayersExample from './examples/layers.md';
import RelayExample from './examples/relay.md';

import styles from './index.module.css';

const INSTALL = 'cargo add svir';

function CopyCommand() {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(INSTALL).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  };
  return (
    <button
      type="button"
      className={styles.install}
      onClick={copy}
      aria-label={translate(
        {id: 'homepage.install.copyLabel', message: 'Copy "{command}"'},
        {command: INSTALL},
      )}>
      <span className={styles.prompt} aria-hidden="true">$</span>
      <code>{INSTALL}</code>
      <span className={styles.copyState} aria-live="polite">
        {copied ? (
          <Translate id="homepage.install.copied">copied</Translate>
        ) : (
          <Translate id="homepage.install.copy">copy</Translate>
        )}
      </span>
    </button>
  );
}

// Dotted currents behind the hero: the logo's three dots, flowing.
function Streams() {
  return (
    <svg className={styles.streams} viewBox="0 0 1440 420" preserveAspectRatio="none" aria-hidden="true">
      <path className={styles.stream} d="M-40 250 C 240 180, 480 320, 720 250 S 1200 180, 1480 250" />
      <path className={clsx(styles.stream, styles.streamSlow)} d="M-40 300 C 260 250, 500 360, 760 300 S 1180 240, 1480 310" />
      <path className={clsx(styles.stream, styles.streamFaint)} d="M-40 200 C 220 150, 520 260, 740 200 S 1220 140, 1480 195" />
    </svg>
  );
}

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={styles.hero}>
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.grid} />
        <div className={styles.glow} />
        <Streams />
      </div>
      <div className={clsx('container', styles.heroContent)}>
        <Heading as="h1" className={styles.title}>
          <Logo className={styles.logo} aria-hidden="true" focusable="false" />
          <span className={styles.visuallyHidden}>{siteConfig.title}</span>
        </Heading>
        <p className={styles.tagline}>
          <Translate id="homepage.tagline">
            A small, composable Rust SDK for talking to large language models.
          </Translate>
        </p>
        <p className={styles.lede}>
          <Translate id="homepage.lede">
            The wire protocol between your application and a model server, and nothing it does not need.
          </Translate>
        </p>
        <div className={styles.buttons}>
          <Link className={clsx('button button--lg', styles.primaryButton)} to="/docs/intro">
            <Translate id="homepage.getStarted">Get started</Translate>
          </Link>
          <Link className={clsx('button button--lg', styles.ghostButton)} to="/docs/agent-skill">
            <Translate id="homepage.agentSkill">Agent Skill</Translate>
          </Link>
        </div>
        <CopyCommand />
      </div>
    </header>
  );
}

const SERVERS = ['LM Studio', 'llama.cpp', 'vLLM', 'mlx-lm', 'Azure OpenAI'];

function WorksWith() {
  return (
    <section className={styles.worksWith}>
      <div className="container">
        <p className={styles.worksWithLabel}>
          <Translate id="homepage.worksWith.label">
            Speaks OpenAI-compatible Chat Completions, as served by
          </Translate>
        </p>
        <ul className={styles.servers}>
          {SERVERS.map((name) => (
            <li key={name}>{name}</li>
          ))}
          <li>
            <Translate id="homepage.worksWith.hosted">OpenAI-compatible endpoints</Translate>
          </li>
        </ul>
      </div>
    </section>
  );
}

type Example = {
  title: ReactNode;
  body: ReactNode;
  link: {to: string; label: ReactNode};
  Code: ComponentType;
};

const code = (text: string) => <code>{text}</code>;

const EXAMPLES: Example[] = [
  {
    title: <Translate id="homepage.example.stream.title">Stream an answer</Translate>,
    body: (
      <Translate id="homepage.example.stream.desc" values={{complete: code('client.complete')}}>
        {'Text arrives as events while the model writes it. The last event carries the whole answer: text, reasoning, tool calls, usage and timing. {complete} waits for it instead, and dropping the stream cancels the request.'}
      </Translate>
    ),
    link: {
      to: '/docs/basics/answers',
      label: <Translate id="homepage.example.stream.link">Reading an answer</Translate>,
    },
    Code: StreamExample,
  },
  {
    title: <Translate id="homepage.example.tools.title">Give it tools</Translate>,
    body: (
      <Translate id="homepage.example.tools.desc">
        A tool is a description and a handler. Arguments are deserialized into your type, the schema
        can be derived from it, and a failure goes back to the model as text it can act on. The loop
        that feeds results back is a few lines of your own, with a bound you choose.
      </Translate>
    ),
    link: {
      to: '/docs/basics/tools',
      label: <Translate id="homepage.example.tools.link">Tools</Translate>,
    },
    Code: ToolsExample,
  },
  {
    title: <Translate id="homepage.example.layers.title">Compose layers</Translate>,
    body: (
      <Translate
        id="homepage.example.layers.desc"
        values={{retry: code('Retry'), timeout: code('Timeout'), trace: code('Trace')}}>
        {'Middleware around every call. {retry}, {timeout} and {trace} are built in; a closure or a type of your own goes in the same chain. Nothing is retried once the answer has started.'}
      </Translate>
    ),
    link: {
      to: '/docs/client/layers',
      label: <Translate id="homepage.example.layers.link">Layers</Translate>,
    },
    Code: LayersExample,
  },
  {
    title: <Translate id="homepage.example.relay.title">Relay through a proxy</Translate>,
    body: (
      <Translate id="homepage.example.relay.desc">
        Pass the server's bytes on unchanged and read them on the way past. The push-based decoder
        does no I/O, so a chat backend can stream to a browser and still keep the finished answer.
      </Translate>
    ),
    link: {
      to: '/docs/advanced/proxy',
      label: <Translate id="homepage.example.relay.link">Relaying through a proxy</Translate>,
    },
    Code: RelayExample,
  },
];

function Examples() {
  return (
    <section className={styles.examples}>
      {EXAMPLES.map(({title, body, link, Code}, idx) => (
        <div key={link.to} className={clsx(styles.example, idx % 2 === 1 && styles.reverse)}>
          <div className={styles.description}>
            <span className={styles.step}>{String(idx + 1).padStart(2, '0')}</span>
            <Heading as="h2">{title}</Heading>
            <p>{body}</p>
            <Link className={styles.more} to={link.to}>
              {link.label} <span aria-hidden="true">-&gt;</span>
            </Link>
          </div>
          <div className={styles.code}>
            <MDXContent>
              <Code />
            </MDXContent>
          </div>
        </div>
      ))}
    </section>
  );
}

function TheName() {
  return (
    <section className={styles.name}>
      <div className="container">
        <Heading as="h2">
          <Translate id="homepage.name.title">The name</Translate>
        </Heading>
        <p>
          <Translate
            id="homepage.name.desc"
            values={{
              volga: <a href="https://github.com/RomanEmreis/volga">volga</a>,
              neva: <a href="https://romanemreis.github.io/neva-docs/">neva</a>,
            }}>
            {'The Svir is the river that joins Lake Onega to Lake Ladoga; the Neva then carries that water to the Baltic. svir sits in the same family as {volga} (HTTP) and {neva} (MCP), and like its river it joins two bodies of water that already exist: your application and a model server.'}
          </Translate>
        </p>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title={translate({id: 'homepage.title', message: 'Rust SDK for LLMs'})}
      description={translate({
        id: 'homepage.description',
        message: 'A small, composable Rust SDK for talking to large language models.',
      })}>
      <HomepageHeader />
      <main>
        <WorksWith />
        <HomepageFeatures />
        <Examples />
        <TheName />
      </main>
    </Layout>
  );
}
