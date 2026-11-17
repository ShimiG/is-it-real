# Platform AI labels: what is known

The label matcher (`packages/core/src/platform-labels.ts`) recognises the labels that platforms themselves put on content. A match gives _Made with AI_. This page records which wordings are covered, where each came from, and what the platforms' own rules mean for the tool.

Labels are shown in the language of the person's account. Every wording has to be listed per language; a label in a language that is not listed is not recognised. When that happens, **Save a report for the developer** in the extension lists the label-like texts it saw, which is how new wordings get added.

## Covered wordings

| Platform                     | Wording                                        | Language | Source                                                           |
| ---------------------------- | ---------------------------------------------- | -------- | ---------------------------------------------------------------- |
| Facebook, Instagram, Threads | AI info                                        | English  | Meta's 2024 label, still used on posts                           |
|                              | AI content                                     | English  | Meta help article (below)                                        |
|                              | Made with AI, Imagined with AI, AI-generated   | English  | earlier labels and Meta AI's own pictures                        |
|                              | AI creator, AI-generated profile               | English  | profile labels of 2026, also shown next to the account's posts   |
|                              | "An AI label was added to this content by ..." | English  | translated back from the Hebrew wording; not seen on a real page |
|                              | תוכן שנוצר באמצעות AI                          | Hebrew   | a real Facebook reel (owner's report, 2026-11-16)                |
|                              | תווית AI נוספה לתוכן הזה על ידי ...            | Hebrew   | the same reel                                                    |
| YouTube                      | Made with AI, Altered or synthetic content     | English  | YouTube's disclosure label                                       |
| TikTok                       | Creator labeled as AI-generated, AI-generated  | English  | TikTok's label                                                   |
| LinkedIn                     | Content credentials                            | English  | LinkedIn's Content Credentials mark                              |

Not covered: every other language; X; Reddit.

## What Meta's help article says, and what follows from it

From "How AI-generated content is identified on Meta products" (Meta Help Centre, read 2026-11-16):

| Meta says                                                                                                                    | For this tool                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Content gets the label when Meta's systems find "industry-standard signals" in it, or when the person who posts it labels it | The same signals (Content Credentials, the IPTC label) are what the tool reads in original files. On Meta's sites the tool reads the label |
| Content that was only **modified** with AI gets no label on the post; the note is under the post's Options menu              | The tool cannot see that note. Edited-with-AI content on Meta's sites is not reported                                                      |
| A label is **required** for photorealistic video and realistic-sounding audio. It is **not required for images**             | On Meta's sites, a missing label on a picture means nothing                                                                                |
| Video in a cartoon style does not need a label                                                                               | The same blind spot as the tool's own: drawn and animated content is not judged                                                            |
| Accounts that mostly post AI content can carry an "AI creator" label, also shown next to their posts                         | Recognised as a label                                                                                                                      |
| Meta AI's own pictures may carry a visible watermark                                                                         | Not read (would need reading text inside the picture)                                                                                      |
| "Not all AI content contains the information needed to identify it"                                                          | Meta's labels miss content too; no label is never proof                                                                                    |
| Meta offers its own checker for a photo or video (meta.ai/identification)                                                    | The tool works offline and does not send content anywhere (ADR-0003), so it does not use it. People can try it themselves                  |

## Where the label sits, and what the tool can see

Instagram's help page ("Labeling AI content", read 2026-11-16) says the same as Meta's, and adds where the label is shown:

| Instagram says                                                                                                | For this tool                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Content made with Meta AI tools, or with "created with AI" signals, is labeled "above or on the content"      | Read when the label is on the page                                                                                                                                              |
| Information about AI use "can be found by clicking the Options menu on any post, story, reel or thread"       | **Not seen.** The tool reads the page as it is and never clicks. If the person opens that menu or the "about" panel first and then checks, the label is on the page and is read |
| People add the label with an "Add AI label" switch when they post; a profile can carry "AI-generated profile" | Both wordings are recognised                                                                                                                                                    |
| Meta may add the label itself when it detects AI content that was not labeled                                 | Same label, read the same way                                                                                                                                                   |

On a video's own page (a reel, a short, a watch page) a label found anywhere on the page is reported on that video. On a feed it cannot be tied to one post and is reported as a line of its own.

## What YouTube's help page says

From "Understanding 'How this content was made' disclosures on YouTube" (YouTube Help, read 2026-11-17):

| YouTube says                                                                                                                                                                                                             | For this tool                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The disclosure is "Made with AI": content "meaningfully altered or synthetically generated with Gen AI tools"                                                                                                            | Recognised as a label (from labels 0.3.0), when it is the whole text, so that a video title starting with the same words does not count                                                                                            |
| It is shown "in the video player or description"; details are in the "How this content was made" section of the **expanded** description                                                                                 | Read when it is on the page. If the description is folded, the section may not be there: expanding the description first and then checking makes sure it is read (the tool never clicks)                                           |
| "How this content was made" can also hold "Captured with a camera"                                                                                                                                                       | The heading on its own is **not** a label any more (it was counted as one up to labels 0.2.0, which would have marked camera-signed video as AI-made). "Captured with a camera" is not read: the tool never says something is real |
| The label comes from the creator's own disclosure, from YouTube's AI tools (such as DreamScreen), or from Content Credentials (C2PA 2.1 or higher) saying the **whole** video is AI-made; YouTube may also add it itself | All read the same way, as YouTube's label                                                                                                                                                                                          |
| "Info from ..." names who signed the Content Credentials behind a disclosure                                                                                                                                             | Not a label on its own (it also appears under "Captured with a camera")                                                                                                                                                            |
| The older label read "Altered or synthetic content"                                                                                                                                                                      | Still recognised                                                                                                                                                                                                                   |

The original file's Content Credentials are not available to the tool on YouTube (the video is streamed), so YouTube's label is the only way to see them there.

## Any other site

There is no rule for unknown sites. A short text "AI-generated" on some site is the word of whoever runs it, not a platform's label. Next to a picture or video it is read as a hint (_Likely made with AI_, decision record 0014).
