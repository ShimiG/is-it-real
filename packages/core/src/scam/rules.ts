import type { ReasonCode } from '../types.js';

/**
 * Scam rules. Each rule is a list of patterns tested sentence by sentence (lower-cased,
 * normalised text). Weights are summed once per rule per text (see engine.ts).
 *
 * Writing rules: prefer patterns that describe a REQUEST or CLAIM aimed at the reader
 * ("pay with gift cards", "this is the IRS") over topic words ("gift card", "IRS"), because
 * benign pages talk about the same topics.
 */
export interface ScamRule {
  id: string;
  reason: ReasonCode;
  weight: number;
  patterns: RegExp[];
  /** Extra weight for each additional distinct pattern matched (independent claims add up). */
  stack?: number;
  /** Cap on the total weight of this rule. */
  maxWeight?: number;
  /**
   * Skip a match when a negation precedes it in the same sentence ("we will NEVER ask you to pay
   * with gift cards"). Off for rules whose patterns are themselves negations (secrecy).
   */
  negatable: boolean;
}

const GIFT = String.raw`(?:gift ?cards?|prepaid (?:debit |visa )?cards?|(?:apple|itunes|google play|steam|ebay|amazon|target|walmart|visa|razer gold|vanilla)(?: gift)? cards?)`;
const CRYPTO = String.raw`(?:bitcoin|btc|crypto(?:currency|currencies)?|usdt|tether|ethereum)`;
const WIRE = String.raw`(?:wire transfer|western union|moneygram|zelle|cash app|money order)`;

export const SCAM_RULES: ScamRule[] = [
  {
    id: 'unusual_payment',
    reason: 'scam_unusual_payment',
    weight: 3,
    negatable: true,
    patterns: [
      // Paying someone (not buying a product) with gift cards / crypto / wire services.
      new RegExp(
        String.raw`\b(?:pay|paid|payment|payable|settle|cover|fee|fine|bill|donations?|accept\w*)\b[^.]{0,60}\b${GIFT}`,
      ),
      new RegExp(
        String.raw`\b${GIFT}\b[^.]{0,80}\b(?:codes?|numbers?|photos?|pictures?|scratch|back of)\b`,
      ),
      new RegExp(
        String.raw`\b(?:scratch|codes? on the back|card numbers?|claim number)\b[^.]{0,40}\b(?:send|text|read|give|call)\b`,
      ),
      new RegExp(
        String.raw`\b(?:send|text|read|give)\b[^.]{0,40}\b(?:codes? on the back|card numbers?|claim number|photos? of the (?:numbers|codes|cards))\b`,
      ),
      new RegExp(
        String.raw`\b${CRYPTO}\b[^.]{0,40}\b(?:atm|only way|payable|fee|pay\w*|send|deposit|wallet address)\b`,
      ),
      new RegExp(
        String.raw`\b(?:pay|send|deposit|payable|in|by|through|via)\b[^.]{0,30}\b${CRYPTO}\b`,
      ),
      new RegExp(String.raw`\b(?:send|pay|transfer|wire|through|by|via)\b[^.]{0,40}\b${WIRE}`),
      new RegExp(
        String.raw`\b${WIRE}\b[^.]{0,40}\b(?:today|now|right away|immediately|to (?:our|the|my))\b`,
      ),
      /\bcourier (?:will|can|to) (?:come|pick)|\bpick up the (?:cash|money)\b/,
      /\bwithdraw (?:your |the |all )?(?:savings|money|cash)\b/,
      /\b(?:safe|protected|secure|federal) (?:bank )?account\b/,
      /\bonly (?:accept|be accepted|through|by)\b[^.]{0,40}\b(?:gift ?cards?|crypto|bitcoin|wire)/,
      // Overpayment / fake-check scams: deposit our check, send part of it back.
      /\b(?:deposit|cash)\b[^.]{0,40}\b(?:check|cheque)\b[^.]{0,100}\b(?:send|wire|transfer|return)\b/,
      /\b(?:wire|send|transfer) (?:\$|£|€)?[\d,]+ back\b|\bkeep \$[\d,]+\b[^.]{0,60}\b(?:send|wire|transfer)\b/,
    ],
  },
  {
    id: 'code_request',
    reason: 'scam_code_request',
    weight: 3,
    negatable: true,
    patterns: [
      /\b(?:read|tell|give|share|send|confirm)\b(?: me)?(?: back)?[^.]{0,30}\b(?:\w+[- ]digit |verification |security |one[- ]time |access |pass)?(?:code|passcode|pin)\b(?! on the back)/,
    ],
  },
  {
    id: 'secrecy',
    reason: 'scam_secrecy',
    weight: 2.5,
    negatable: false,
    patterns: [
      /\b(?:don'?t|do not|never) (?:tell|inform|discuss (?:this |it )?with|mention (?:this|it) to)\b[^.]{0,30}\b(?:anyone|anybody|family|bank|children|kids|son|daughter|husband|wife|parents|mom|mum|dad|teller|staff)\b/,
      /\bkeep (?:this|it|your [a-z ]{1,25}?) (?:a )?(?:secret|confidential|private|between us)\b/,
      /\b(?:treat|keep) this (?:matter )?(?:with|in) (?:strict |the strictest )?confidential/,
      /\b(?:this|the) (?:offer|matter|call|deal) is (?:strictly )?confidential\b/,
      /\b(?:do not|don'?t) discuss this\b/,
      /\b(?:they|staff|teller|bank) (?:may|might|could) be involved\b/,
      /\b(?:do not|don'?t|please don'?t) (?:call|phone)(?: me)?,? i (?:can'?t|cannot) talk\b/,
      /\bdo not share (?:your|this)? ?(?:winning )?number\b/,
    ],
  },
  {
    id: 'tech_support',
    reason: 'scam_tech_support',
    weight: 3,
    negatable: true,
    patterns: [
      /\b(?:computer|pc|device|browser|laptop|mac|system|windows)\b[^.]{0,40}\b(?:infected|hacked|compromised|has been locked|is locked|sending (?:viruses|your))\b/,
      /\b(?:virus|malware|threat|suspicious activity)(?:es)? (?:detected|found)\b/,
      /\b(?:anydesk|teamviewer|ultraviewer|logmein|remote access|connect to your computer)\b/,
      /\b(?:call|contact)\b[^.]{0,25}\b(?:windows|microsoft|apple|norton|mcafee|geek squad)?\s?(?:support|technician|helpdesk|help desk|technical department)\b[^.]{0,40}\d{3}/,
      /\bdo not (?:close|restart|turn off|shut down) (?:this|your)\b/,
      /\b(?:license|licence) (?:is|will be) (?:cancell?ed|suspended|expired)\b/,
    ],
  },
  {
    id: 'threat',
    reason: 'scam_threat',
    weight: 2,
    negatable: true,
    patterns: [
      // Aimed at the reader ("warrant for your arrest"), not news about someone else's arrest.
      /\b(?:you|your)\b[^.]{0,50}\b(?:warrant|arrest\w*|lawsuit|legal action|deport\w*|custody|jail)\b/,
      /\b(?:warrant|arrest\w*|lawsuit|legal action)\b[^.]{0,40}\b(?:you|your)\b/,
      /\b(?:police|officers|deputies|sheriff)\b[^.]{0,30}\b(?:will|are|arrive|come|sent)\b/,
      /\b(?:account|number|benefits|card|access|membership|license|licence)\b[^.]{0,40}\b(?:suspended|suspension|locked|frozen|disabled|closed|closure|terminated|on hold|blocked|stop)\b/,
      /\b(?:disconnect\w*|shut off|cut off)\b/,
    ],
  },
  {
    id: 'time_pressure',
    reason: 'scam_urgency',
    weight: 1,
    negatable: false,
    patterns: [
      /\bwithin (?:the next )?\d+ (?:hours?|minutes?)\b|\bin \d+ (?:hours?|minutes?)\b/,
      /\b(?:immediately|right away|act now|urgent(?:ly)?|asap|hurry|final (?:notice|reminder|warning)|last (?:chance|warning))\b/,
      /\b(?:today|tonight)\b[^.]{0,20}\b(?:only|or|before|deadline)\b|\bbefore it expires\b|\bexpires? (?:today|tonight|soon|on)\b|\bends? (?:today|tonight|at midnight|this week)\b|\buntil midnight\b/,
      /\b(?:limited[- ]time|spots are limited|only \d+ (?:slots|spots|places))\b/,
    ],
  },
  {
    id: 'impersonation',
    reason: 'scam_impersonation',
    weight: 1.5,
    negatable: true,
    patterns: [
      /\b(?:this is|i'?m|i am|we are|calling from|(?:message|notice|alert) from|on behalf of)\b[^.]{0,40}\b(?:irs|internal revenue|tax office|social security|medicare|fbi|police|sheriff|court|government|federal|microsoft|apple|windows|amazon|paypal|your bank|bank'?s|fraud (?:department|team)|security team|technical department|department of)\b/,
      /\b(?:officer|deputy|sergeant|agent|barrister|attorney|public defender)\b [a-z]+\b[^.]{0,40}\b(?:irs|internal revenue|sheriff|police|court|department|office|grandson|granddaughter)\b/,
      /^(?:wells fargo|chase(?: bank)?|bank of america|paypal|amazon|netflix|apple|usps|fedex|dhl|ups|e-zpass|ezpass|sunpass|irs|social security administration|federal grant department|department of education)(?: \w+)?\s?(?::|alert|notice)/,
    ],
  },
  {
    id: 'personal_data',
    reason: 'scam_personal_data_request',
    weight: 2,
    negatable: true,
    patterns: [
      /\b(?:verify|confirm|update|validate|re-?activate)\b(?: your)?[^.]{0,20}\b(?:identity|account|payment|billing|card|bank|personal|login|information|details|apple id)\b/,
      /\b(?:need|provide|send|give|reply with|confirm|read me|with)\b[^.]{0,20}\b(?:your )?(?:full name|date of birth|medicare (?:number|id)|social security number|ssn|bank (?:account|details)|card (?:number|details)|password|account (?:number|information|details)|payment details|billing information|(?:your )?details)\b/,
      /\b(?:press 1|stay on the line|do not hang up|don'?t hang up)\b/,
    ],
  },
  {
    id: 'too_good',
    reason: 'scam_too_good_to_be_true',
    weight: 2,
    stack: 1,
    maxWeight: 4,
    negatable: true,
    patterns: [
      /\byou(?:'ve| have)? (?:won|been selected|been chosen|are the lucky)\b|\b(?:lucky|grand prize) winner\b/,
      /\bclaim (?:your )?(?:prize|reward|winnings|car)\b|\bsweepstakes\b|\bgiveaway\b|\binternational (?:mega )?lottery\b|\byour email address won\b/,
      /\bguarantee[ds]?\b[^.]{0,25}\b(?:returns?|profits?|withdrawals?)\b|\b(?:returns?|profits?|withdrawals?) (?:are )?guaranteed\b|\bit is guaranteed\b|\bguaranteed\b[^.]{0,20}\b\d+%/,
      /\b(?:zero|no) risk\b|\brisk[- ]free\b|\bdouble your (?:money|investment)\b|\bturns? \$[\d,]+ into \$/,
      /\$[\d,]+ (?:a|per) day\b|\b\d+% in one day\b|\bnever (?:has to be|needs to be) repaid\b|\bentitled to inherit\b|\binsider (?:signals|tips)\b|\bsecret investment\b|\bhas never lost\b/,
      /\b(?:banks|doctors|the government|they) (?:don'?t|do not) want you to know\b/,
      /\b(?:elon musk|warren buffett|bill gates|jeff bezos|oprah|mark zuckerberg)'?s?\b[^.]{0,60}\b(?:invest\w*|trading|crypto|bitcoin|platform|returns)\b/,
    ],
  },
  {
    id: 'upfront_fee',
    reason: 'scam_upfront_fee',
    weight: 2,
    negatable: true,
    patterns: [
      /\b(?:processing|release|activation|delivery|shipping|registration|insurance|recovery|legal|transfer|customs|redelivery|handling|clearance|closing|import)\b(?: and \w+)? (?:fees?|charges?|duty|costs)\b/,
      /\b(?:pay|send|cover)\b[^.]{0,40}\b(?:fee|fees|duty|closing costs)\b/,
    ],
  },
];

/**
 * Text-level rule for family-emergency ("grandparent") scams: someone close + trouble + money,
 * anywhere in the message. Sentence-level rules miss it because the parts are spread out.
 */
export const FAMILY_EMERGENCY = {
  reason: 'scam_family_emergency' as const,
  weight: 2.5,
  who: /\b(?:grandma|grandpa|grandmother|grandfather|nana|granny|mom|mum|dad|mother|father),? (?:it'?s|this is) (?:me|your)\b|\bthis is my new number\b|\bmessaging from a friend'?s phone\b|\b(?:your|for your) (?:grandson|granddaughter)\b|\bi'?m your (?:grandson|granddaughter)\b/,
  trouble:
    /\b(?:arrested|jail|bail|accident|hospital|in (?:big )?trouble|stuck|lawyer|public defender|police|broke (?:my|his|her)|phone (?:fell|broke|died)|mine broke|locked)\b/,
  money: /[$£€]\s?\d|\b(?:money|cash|bail|pay|transfer|send|bill)\b/,
};

/**
 * Sentences that describe scams (awareness articles, news) instead of making demands.
 * Rules ignore them. Scam messages rarely call themselves scams or quote "what scammers say".
 */
export const REPORTING_SPEECH =
  /\b(?:scams?|scammers?|fraudsters?|con artists?|beware|red flags?|warning signs?|how to spot|watch out)\b|\b(?:may|might|often|typically|usually|will) (?:say|claim|ask|tell|pretend|insist|threaten)\b|\bpretend(?:ing)? to be\b|\bposing as\b|\bclaiming to be\b|\bvictims?\b|\bprosecutors?\b|\bpolice (?:said|say|urge)\b|\baccording to\b|\bofficials said\b|\bif (?:a|someone|you get|you receive|a caller)\b/;

/** A negation before a match ("we will never ask you to ..."). */
export const NEGATION =
  /\b(?:never|no (?:real|legitimate|one|business|agency)|will not|won'?t|does not|doesn'?t|do not|don'?t|no such thing|is not|isn'?t|not (?:a )?(?:real|legitimate))\b/;
