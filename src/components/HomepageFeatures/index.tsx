import type {ReactNode} from 'react';
import Heading from '@theme/Heading';
import Translate, {translate} from '@docusaurus/Translate';
import styles from './styles.module.css';

type Feature = {
  title: string;
  icon: ReactNode;
  description: ReactNode;
};

// 24x24 stroke icons, drawn in currentColor.
const Icon = ({children}: {children: ReactNode}) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const code = (text: string) => <code>{text}</code>;

const FEATURES: Feature[] = [
  {
    title: translate({id: 'homepage.feature.streaming.title', message: 'Streaming, end to end'}),
    icon: (
      <Icon>
        <path d="M3 8c3-3 6 3 9 0s6 3 9 0" />
        <path d="M3 16c3-3 6 3 9 0s6 3 9 0" />
      </Icon>
    ),
    description: (
      <Translate id="homepage.feature.streaming.desc">
        The request body streams from disk with an exact length; the answer streams back as events.
        The last event is the whole answer, and dropping the stream cancels the request.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.lossless.title', message: 'Nothing lost silently'}),
    icon: (
      <Icon>
        <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
        <path d="M9 12l2 2 4-4" />
      </Icon>
    ),
    description: (
      <Translate id="homepage.feature.lossless.desc">
        Tool-call IDs and reasoning survive a round trip. Something that cannot be represented is an
        explicit error, never a dropped field. Keys never reach errors, events or logs.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.tools.title', message: 'Tools without macros'}),
    icon: (
      <Icon>
        <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.5 2.5-2.5-.5-.5-2.5z" />
      </Icon>
    ),
    description: (
      <Translate id="homepage.feature.tools.desc">
        A tool is a description and a handler. Arguments deserialize into your type, schemas can be
        derived from it, and the loop that feeds results back stays in your hands.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.layers.title', message: 'Layers'}),
    icon: (
      <Icon>
        <path d="M12 3l9 5-9 5-9-5z" />
        <path d="M3 13l9 5 9-5" />
      </Icon>
    ),
    description: (
      <Translate
        id="homepage.feature.layers.desc"
        values={{retry: code('Retry'), timeout: code('Timeout'), trace: code('Trace')}}>
        {'Middleware around every call: {retry}, {timeout} and {trace} built in, a closure or a type of your own next to them. A client without layers pays nothing for them.'}
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.strict.title', message: 'Strict and bounded'}),
    icon: (
      <Icon>
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16M9 4v16" />
      </Icon>
    ),
    description: (
      <Translate id="homepage.feature.strict.desc">
        Unknown input is an error unless you ask for leniency. Bytes, events and tool calls always
        have limits, and reaching one is a typed outcome, not a hang.
      </Translate>
    ),
  },
  {
    title: translate({id: 'homepage.feature.testable.title', message: 'Testable without a model'}),
    icon: (
      <Icon>
        <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3" />
        <path d="M7.5 15h9" />
      </Icon>
    ),
    description: (
      <Translate id="homepage.feature.testable.desc">
        The transport sits behind one trait. Swap in a scripted backend and test the code that calls
        a model with no server, no network and no keys.
      </Translate>
    ),
  },
];

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.grid}>
          {FEATURES.map(({title, icon, description}) => (
            <div key={title} className={styles.card}>
              <div className={styles.icon}>{icon}</div>
              <Heading as="h3">{title}</Heading>
              <p>{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
