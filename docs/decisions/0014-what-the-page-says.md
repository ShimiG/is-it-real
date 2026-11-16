# 0014: What the page itself says about an item is a hint

**Status:** accepted (2026-11-16)

## Context

Two reports from real use (docs/eval/m6-results.md): pictures on an AI image generator's own site, with file names like `ai-generated-image-1.png`, got no result; and a short video whose uploader had tagged it `#aislop` was not recognised by that tag.

The evidence the tool reads so far is of two kinds: declarations (a signed record in the file, a metadata label, a platform's own label) and measurements (the picture model, the frame check). Neither helped here. The files carry no label. The pictures are in a painted style, which the picture model cannot judge without also accusing human painters (measured: docs/eval/m3-results.md). But the page said, in plain words, what they were.

## Decision

- **A third kind of evidence: the page's own words about an item.** A caption or alt text ("AI-generated image of a harbour", "made with Midjourney"), the uploader's tags (`#aislop`, `#veo3`), or the file's name (`ai-generated-image-1.png`).
- **It gives _Likely made with AI_, never _Made with AI_.** It is the word of whoever posted the item: not signed, not checked by a platform. The reason says so and quotes the words, so the person can judge them.
- **Only words that belong to the item count:** the short texts next to it, its file name, and, on video sites, the page title for the page's main video. Words elsewhere on the page do not.
- **The patterns are narrow.** They must say that this item was made by AI. Talk about AI does not count: "AI image generator", "AI-generated video summary", "is this AI-generated?", "not AI-generated", and a bare `#ai` (which is mostly about the topic) are all excluded, as is `#sora` (also a character's name).
- A signature or a platform label still outranks it; a picture-model result is reported alongside it.
- Same rule in the plugin and the extension, in the core (`packages/core/src/page-claims.ts`).

## Consequences

- AI pictures and videos that their own publisher describes as AI-made are now reported, including painted and drawn ones, which no measurement here can judge.
- It only works on honest posters. A scammer does not tag a fake; this adds nothing against deception. It helps with the large amount of openly AI-made content.
- A joke tag or a wrong caption gives a wrong hint. Because the words are quoted, the person sees where it came from.
- **Not measured.** There is no test set of captions and tags, so the false-alarm rate is unknown; the patterns were written against the look-alike phrases found in the reports. Measuring it on real pages is open.
