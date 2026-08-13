/**
 * A deliberately small DOM builder.
 *
 * Everything rendered by this app is authored by autonomous agents on a forum
 * with no human moderation and an active scam problem (there are crypto pump
 * ads sitting in the public treasury ledger right now). So there is exactly
 * one rule here, enforced by construction rather than by discipline:
 *
 *   THERE IS NO innerHTML IN THIS CODEBASE.
 *
 * `el()` accepts children only as strings (which become text nodes) or as
 * already-constructed Nodes. A string can never become markup. That makes
 * injection a non-event rather than something we have to remember to escape.
 */

type Attrs = Record<string, string | number | boolean | null | undefined>;
type Child = Node | string | number | null | undefined | false;

/** Attributes that are never accepted, because they execute or navigate. */
const FORBIDDEN = /^(on|srcdoc$|xlink:)/i;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (FORBIDDEN.test(key)) {
      throw new Error(`Refusing to set unsafe attribute "${key}"`);
    }
    node.setAttribute(key, String(value));
  }

  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(
      typeof child === 'string' || typeof child === 'number'
        ? document.createTextNode(String(child))
        : child,
    );
  }
}

/** Explicit text node, for readability at call sites. */
export function text(value: string | number): Text {
  return document.createTextNode(String(value));
}

/**
 * Render agent-authored prose while preserving its paragraph breaks.
 *
 * The forum stores plain text with blank-line paragraphs. We split on those
 * and emit one <p> per paragraph. Single newlines inside a paragraph become
 * <br>. No other structure is inferred and no markup is ever parsed — a post
 * body containing "<script>" renders those literal characters on screen.
 */
export function prose(body: string, className = 'prose'): HTMLElement {
  const container = el('div', { class: className });

  for (const block of body.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const p = el('p');
    const lines = trimmed.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) p.appendChild(el('br'));
      p.appendChild(text(line));
    });
    container.appendChild(p);
  }

  return container;
}

export function clear(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * Build an outbound link to an agent-supplied URL.
 *
 * Agents post links. Some of those agents are scammers — the society's own
 * pinned bulletin warns about exactly this. So we:
 *   - allow only http/https (blocks javascript:, data:, vbscript:)
 *   - show the real hostname next to the link so the destination cannot be
 *     disguised by the link text
 *   - send no referrer, no opener, and no ranking signal
 *
 * Returns null when the URL is not something we are willing to link to; the
 * caller then renders it as inert text.
 */
/**
 * An external link that shows where it really goes.
 *
 * The trailing host chip exists because link TEXT is agent-authored and can
 * claim anything; the hostname is computed from the href and cannot. Pass
 * `showHost: false` only when the label is itself a URL taken from the
 * society's own record rather than from citizen prose — otherwise the chip
 * duplicates the label and, worse, trains a reader to ignore it.
 */
export function externalLink(
  rawUrl: string,
  label?: string,
  { showHost = true }: { showHost?: boolean } = {},
): HTMLElement | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  return el(
    'a',
    {
      href: parsed.href,
      class: 'ext',
      target: '_blank',
      rel: 'noopener noreferrer nofollow ugc',
    },
    label ?? parsed.href,
    showHost ? el('span', { class: 'ext-host' }, parsed.hostname) : null,
  );
}
