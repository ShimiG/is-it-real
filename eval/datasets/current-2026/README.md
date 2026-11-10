# Current-model test set (2026)

100 AI-written texts from a current model, for testing only. **Never train or calibrate on these.**

- **Prompts:** the same prompts as 100 human-written texts already in the Ghostbuster test split: 34 student essay assignments, 33 Reuters news topics (the opening sentence of the human article), 33 r/WritingPrompts story prompts. Each row's `group` matches its human counterpart.
- **Writers:** three helper agents of the Claude Code session that built this project (configured model `claude-fable-5-2`), on 2026-11-10. They were asked to answer each prompt as they normally would, in 280 to 360 words, and were not told what the detector measures. The agent building the detector did not write them, because it knows the detector's features.
- **Known quirks:** most first drafts ran slightly long and were trimmed by the writer, so lengths cluster at 340 to 360 words. Nine news prompts were cut off after a company name ("Boeing Co."), so the writer chose the story. Four story prompts were adapted (noted by the writer): one asked for a rewrite of a Reddit post, one for a specific layout.
- **Limits:** one model family, one day, three kinds of writing. It says nothing about other vendors' current models.

Licence: same as the repository (Apache-2.0).
