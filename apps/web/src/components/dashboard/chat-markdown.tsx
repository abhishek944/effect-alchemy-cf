import {
  MarkdownTextPrimitive,
  type MarkdownTextPrimitiveProps,
  type SyntaxHighlighterProps,
} from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { CopyButton, useMessageCopy } from "./chat-copy";
import "./chat-markdown.css";

/** The native URL transform runs first; further restrict links to public outbound URLs. */
function outboundUrl(href: string | undefined): string | undefined {
  if (!href || !/^https?:\/\//i.test(href)) return undefined;
  try {
    const url = new URL(href);
    const host = url.hostname.toLowerCase().replace(/\.+$/, "");
    if (
      typeof window === "undefined" ||
      host === window.location.hostname.toLowerCase().replace(/\.+$/, "") ||
      url.username ||
      url.password ||
      !host.includes(".") ||
      host.startsWith("[") ||
      /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      /(?:^|\.)home\.arpa$/.test(host)
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function CodeBlock({ code, components: { Pre, Code } }: SyntaxHighlighterProps) {
  const copy = useMessageCopy();
  return (
    <div data-cx="chat-code-block">
      <Pre>
        <Code>{code}</Code>
      </Pre>
      <div data-cx="chat-code-action">
        <CopyButton text={code} scope={copy.scope} disabled={!copy.enabled} kind="code" />
      </div>
    </div>
  );
}

const components: MarkdownTextPrimitiveProps["components"] = {
  SyntaxHighlighter: CodeBlock,
  a: ({ href, children, title }) => {
    const safeHref = outboundUrl(href);
    return safeHref ? (
      <a href={safeHref} title={title} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    );
  },
  // Never emit an img/src: even Markdown images remain inert text.
  img: ({ alt }) => <span data-cx="chat-markdown-image">[Image: {alt || "omitted"}]</span>,
  // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling of code.
  pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
  table: ({ children }) => (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling of tables.
    <section data-cx="chat-markdown-table" aria-label="Scrollable table" tabIndex={0}>
      <table>{children}</table>
    </section>
  ),
};

const remarkPlugins = [remarkGfm];
const containerProps: NonNullable<MarkdownTextPrimitiveProps["containerProps"]> & {
  "data-cx": string;
} = { "data-cx": "chat-markdown" };

/** Must be mounted as MessagePrimitive.Parts' Text renderer, not outside a part. */
export function ChatMarkdown() {
  const { complete } = useMessageCopy();
  return (
    <MarkdownTextPrimitive
      containerProps={containerProps}
      components={components}
      remarkPlugins={remarkPlugins}
      skipHtml
      smooth={!complete}
      // Deferral must stay constant: switching renderer types loses focus/selection.
      defer={false}
    />
  );
}
