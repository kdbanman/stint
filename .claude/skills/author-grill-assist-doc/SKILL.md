---
name: author-grill-assist-doc
description: >-
  Author a grill assist artifact — a visual, educational HTML digest that
  contextualizes a batch of decision questions. Use when the user can't answer
  a question without a deeper level of understanding.
---

# Author a grill assist doc

A **grill assist artifact** is a nice, visual HTML artifact that contextualizes
a batch of questions for the owner — instead of a flat questionnaire or the
`AskUserQuestion` tool. The whole point of these visual digests is to help a
broad-scope engineering leader make decisions. Sometimes that leader needs a
little bit of extra explanation — "how does the judge generate X?", "what does
Y mean here?" — which doesn't warrant a whole conversation detour, so the
document carries that explanation with it.

These documents will often be **educating a tech lead about a system they
haven't touched yet, or reminding a tech lead about a system they haven't
touched in a while**. Author for that reader: self-contained, understandable,
and educational.

## The delivery loop

1. Author the artifact and publish it (default-private).
2. Ask the questions briefly again in the session after authoring the
   artifact; the user responds in the session after reading the artifact.
3. Redeploy to the same URL on revision — never mint a new artifact for an
   update to the same grill.

## Rules

**Visual first.** Every question gets a picture of the mechanism the decision
turns on — think *very* lightweight-but-clean C4 architectural diagrams in raw
SVG, or intentionally low-fidelity UI mockups. The picture helps the reader
understand the question context *and* the answer consequences. When comparing
options, draw the difference — the one edge an option adds or removes — not a
labeled box per option.

**Common language.** Use common language, particularly based on ASD-STE100
Simplified Technical English (STE) wherever possible, using project or tech
stack jargon only where necessary. Short sentences, active voice, present
tense, one idea per sentence. No idioms.

**Glossary per question.** Ensure all pieces of necessary jargon are briefly
defined in an expandable (default collapsed) glossary at the bottom of each
question section, with definitions also in ASD-STE100.

**FAQs per question.** 3–8 FAQs per question, each in an expandable (default
collapsed), that anticipate questions about subtle things — important system
interactions, reasons for certain behaviours, etc. Decision-relevant context
that someone familiar with the project would already know, but someone new
would not. Again: common language, ASD-STE100, necessary jargon only.

## Structure

Per question section, in order: the question as a plain-language heading → the
context in a few short paragraphs → the mechanism diagram with a caption → the
options, recommendation first and marked as recommended → the routing/label
line → the collapsed FAQs → the collapsed glossary, last.

Open with a one-screen digest: what the batch is, why it comes first, and a
table of every item with its one-line problem statement. Close with the
sequencing — what lands first and why, drawn if it helps.

## Practices

- State facts the document depends on as *verified today*, and re-verify them
  against the current tree before publishing — a grill over stale premises
  wastes the leader's decision.
- Render the page headless and inspect it before publishing; fix label
  collisions and clipped text in the diagrams. Check both light and dark
  themes.
- Recommend an answer for every question, and say it is the recommendation.
  The leader rules; the document argues.
- These artifacts are static: no runtime AI, no external requests. Anything
  the reader will want to ask must already be anticipated in the FAQs — that
  is what the FAQs are for.
