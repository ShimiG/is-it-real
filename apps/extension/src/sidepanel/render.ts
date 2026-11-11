import type { Outcome, ScamRisk } from '@isitreal/core';
import type { PanelItem, PanelResult } from '../messages.js';
import { STRINGS } from '../strings.js';

/**
 * Builds the result the person reads. Rules (PLAN.md section 7): scam risk first; a clear title
 * in words, never colour alone and never a bare number; at most three reasons per item; always
 * say why. All text is set as text, never as HTML, so nothing from the page can run here.
 */
const MAX_REASONS = 3;

/** Symbols carry the meaning together with the words, for people who do not see the colours. */
const SCAM_SYMBOL: Record<ScamRisk, string> = { high: '⚠', medium: '⚠', low: '!', none: '•' };
const OUTCOME_SYMBOL: Record<Outcome, string> = {
  verified_ai: 'AI',
  likely_ai: 'AI?',
  no_clear_signs: '•',
  not_assessed: '–',
};
const ORDER: Outcome[] = ['verified_ai', 'likely_ai', 'no_clear_signs', 'not_assessed'];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function list(texts: readonly string[], className: string): HTMLUListElement {
  const ul = el('ul', className);
  for (const t of texts) ul.append(el('li', undefined, t));
  return ul;
}

/** A card's display name ("Picture 2") and the item behind it. */
interface Named {
  name: string;
  item: PanelItem;
  index: number;
}

function nameItems(items: readonly PanelItem[]): Named[] {
  let image = 0;
  let video = 0;
  return items.map((item, index) => ({
    index,
    item,
    name:
      item.kind === 'text'
        ? STRINGS.itemText
        : item.kind === 'image'
          ? STRINGS.itemImage(++image)
          : item.kind === 'video'
            ? STRINGS.itemVideo(++video)
            : STRINGS.itemPageLabel,
  }));
}

function evidenceLines(item: PanelItem): string[] {
  const e = item.evidence ?? {};
  const lines: string[] = [];
  if (typeof e['issuer'] === 'string' && e['issuer'] !== '')
    lines.push(STRINGS.signedBy(e['issuer']));
  if (typeof e['generators'] === 'string' && e['generators'] !== '')
    lines.push(STRINGS.madeWith(e['generators']));
  if (typeof e['label'] === 'string' && e['label'] !== '')
    lines.push(STRINGS.siteLabel(e['label']));
  return lines;
}

function thumb(named: Named): HTMLImageElement | null {
  if (named.item.preview === undefined) return null;
  const img = el('img', 'thumb');
  img.src = named.item.preview;
  img.alt = named.name;
  img.loading = 'lazy';
  return img;
}

function card(outcome: Outcome, title: string, body: string): HTMLElement {
  const section = el('section', `card outcome-${outcome}`);
  const head = el('h3', 'card-title');
  const badge = el('span', 'badge', OUTCOME_SYMBOL[outcome]);
  badge.setAttribute('aria-hidden', 'true');
  head.append(badge, el('span', undefined, title));
  section.append(head, el('p', 'card-body', body));
  return section;
}

/** What the panel can do with a card beyond showing it. */
export interface CardActions {
  /** Offer to watch a video while it plays (needs the picture check). */
  onWatch?: (target: WatchTarget) => void;
}

export interface WatchTarget {
  item: PanelItem;
  /** "Video 1". */
  name: string;
  card: HTMLElement;
  button: HTMLButtonElement;
  status: HTMLElement;
}

/** One item's card. `name` is its display name ("Picture 2", "Video 1"). */
export function renderItem(name: string, item: PanelItem, actions: CardActions = {}): HTMLElement {
  return itemCard({ name, item, index: 0 }, actions);
}

function itemCard(named: Named, actions: CardActions = {}): HTMLElement {
  const { item } = named;
  const section = card(item.outcome, `${named.name}: ${item.title}`, item.explanation);
  const picture = thumb(named);
  if (picture !== null) section.append(picture);
  const why = [...item.reasons.map((r) => r.text).slice(0, MAX_REASONS), ...evidenceLines(item)];
  if (why.length > 0) section.append(el('h4', 'why', STRINGS.whyHeading), list(why, 'reasons'));
  if (item.note !== undefined) section.append(el('p', 'note', item.note));
  if (item.watch !== undefined && actions.onWatch !== undefined) {
    const button = el('button', 'watch', STRINGS.watchButton);
    button.type = 'button';
    const status = el('p', 'watch-status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const onWatch = actions.onWatch;
    button.addEventListener('click', () =>
      onWatch({ item, name: named.name, card: section, button, status }),
    );
    section.append(button, status);
  }
  return section;
}

function groupCard(group: Named[]): HTMLElement {
  const first = group[0]!.item;
  const section = card(
    first.outcome,
    STRINGS.sameResult(group.length, first.title),
    first.explanation,
  );
  const why = first.reasons.map((r) => r.text).slice(0, MAX_REASONS);
  if (why.length > 0) section.append(el('h4', 'why', STRINGS.whyHeading), list(why, 'reasons'));
  if (first.note !== undefined) section.append(el('p', 'note', first.note));
  const pictures = group.map(thumb).filter((t): t is HTMLImageElement => t !== null);
  if (pictures.length > 0) {
    const details = el('details', 'thumbs');
    details.append(el('summary', undefined, STRINGS.showPictures), ...pictures);
    section.append(details);
  }
  return section;
}

/** Pictures with exactly the same quiet result share one card; findings always get their own. */
function cards(items: readonly PanelItem[], actions: CardActions): HTMLElement[] {
  const named = nameItems(items).sort(
    (a, b) => ORDER.indexOf(a.item.outcome) - ORDER.indexOf(b.item.outcome) || a.index - b.index,
  );
  const groupKey = (n: Named): string | null => {
    const quiet = n.item.outcome === 'no_clear_signs' || n.item.outcome === 'not_assessed';
    return n.item.kind === 'image' && quiet
      ? [n.item.outcome, n.item.note ?? '', ...n.item.reasons.map((r) => r.code)].join('|')
      : null;
  };
  const groups = new Map<string, Named[]>();
  for (const n of named) {
    const key = groupKey(n);
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), n]);
  }
  const out: HTMLElement[] = [];
  for (const n of named) {
    const key = groupKey(n);
    const group = key === null ? null : groups.get(key)!;
    if (group === null || group.length === 1) out.push(itemCard(n, actions));
    else if (group[0] === n) out.push(groupCard(group));
  }
  return out;
}

export function renderResult(result: PanelResult, actions: CardActions = {}): HTMLElement {
  const root = el('div', 'result');

  const scam = el('section', `card scam scam-${result.scam.risk}`);
  scam.append(el('h2', 'section-title', STRINGS.scamHeading));
  const headline = el('p', 'headline');
  const symbol = el('span', 'badge', SCAM_SYMBOL[result.scam.risk]);
  symbol.setAttribute('aria-hidden', 'true');
  headline.append(symbol, el('span', undefined, result.scam.headline));
  scam.append(headline);
  if (result.scam.reasons.length > 0) {
    scam.append(el('h3', 'why', STRINGS.whyHeading));
    const ul = el('ul', 'reasons');
    for (const r of result.scam.reasons.slice(0, MAX_REASONS)) {
      const li = el('li', undefined, r.text);
      if (r.evidence !== undefined && r.evidence !== '')
        li.append(el('span', 'quote', STRINGS.found(r.evidence.slice(0, 120))));
      ul.append(li);
    }
    scam.append(ul);
  }
  if (result.scam.advice.length > 0)
    scam.append(
      el('h3', 'advice-title', STRINGS.adviceHeading),
      list(result.scam.advice, 'advice'),
    );
  root.append(scam);

  const ai = el('section', 'ai');
  ai.append(el('h2', 'section-title', STRINGS.aiHeading));
  if (result.items.length === 0) ai.append(el('p', 'note', STRINGS.nothingToCheck));
  // Watching a video needs the picture check.
  else ai.append(...cards(result.items, result.checks.pictureModel ? actions : {}));
  const hasImages = result.items.some((i) => i.kind === 'image');
  if (result.notChecked > 0) ai.append(el('p', 'note', STRINGS.notChecked(result.notChecked)));
  if (hasImages && !result.checks.contentCredentials)
    ai.append(el('p', 'note', STRINGS.noCredentialsCheck));
  if (hasImages && !result.checks.pictureModel) ai.append(el('p', 'note', STRINGS.noPictureModel));
  ai.append(el('p', 'reminder', STRINGS.reminder));
  root.append(ai);
  return root;
}

/** The result for one picture the person chose with a right-click. */
export function renderPicture(item: PanelItem, checks: PanelResult['checks']): HTMLElement {
  const root = el('div', 'result');
  const section = el('section', 'ai');
  section.append(
    el('h2', 'section-title', STRINGS.pictureHeading),
    renderItem(STRINGS.itemPicture, item),
  );
  if (!checks.contentCredentials) section.append(el('p', 'note', STRINGS.noCredentialsCheck));
  if (!checks.pictureModel) section.append(el('p', 'note', STRINGS.noPictureModel));
  section.append(el('p', 'reminder', STRINGS.reminder));
  root.append(section);
  return root;
}

/** The same result as sentences, for reading aloud. */
export function resultToSpeech(result: PanelResult): string {
  const parts: string[] = [STRINGS.speechScam, result.scam.headline];
  for (const r of result.scam.reasons.slice(0, MAX_REASONS)) parts.push(r.text);
  if (result.scam.advice.length > 0) parts.push(STRINGS.adviceHeading, ...result.scam.advice);
  parts.push(STRINGS.speechAi);
  const named = nameItems(result.items);
  const findings = named.filter(
    (n) => n.item.outcome === 'verified_ai' || n.item.outcome === 'likely_ai',
  );
  for (const n of findings) {
    parts.push(`${n.name}: ${n.item.title}.`);
    for (const r of n.item.reasons.slice(0, MAX_REASONS)) parts.push(r.text);
  }
  const quiet = named.length - findings.length;
  if (findings.length === 0) parts.push(STRINGS.reminder);
  else if (quiet > 0) parts.push(STRINGS.speechOthers(quiet));
  return parts.join(' ');
}
