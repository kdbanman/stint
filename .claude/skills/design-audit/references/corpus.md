# Design corpus — the trusted sources

The curated source set behind `context/design.html` and `checklist.md`.
Tiered by how to use it: **read-first** shapes judgment, **reference** answers
specific questions, **background** frames the whole. Verified July 2026; all
primary sources. This file is the one home for this list — the spec cites
sources one line at a time, never duplicates it.

## Read first (shapes the audit's judgment)

| Source | Author | What it gives the audit | Access |
|---|---|---|---|
| Refactoring UI | Wathan & Schoger | The developer-to-visual-design book: hierarchy by size/weight/space, spacing systems, restrained palettes, shadow logic. Checklist §5 distills it. | Paid — refactoringui.com |
| The menu bar (Apple HIG) | Apple | Menu-bar-extra rules: template icons, popover-first, never the sole access path. | Free — developer.apple.com/design/human-interface-guidelines/the-menu-bar |
| The UI Stack | Scott Hurff | The five states (ideal/empty/error/partial/loading) — why STATES.md exists. | Free — scotthurff.com |
| Web Interface Guidelines | Rauno Freiberg | The interface micro-detail checklist; checklist §4 distills it. | Free — interfaces.rauno.me |

## Reference (answer specific questions during an audit)

| Source | Author | Use for | Access |
|---|---|---|---|
| WCAG 2.2 | W3C | The exact floor numbers: 1.4.3 contrast, 1.4.11 non-text, 2.4.7/2.4.11 focus, 2.5.8 target size — and the sanctioned exemptions. | Free — w3.org/TR/WCAG22 |
| Radix Colors docs | WorkOS/Radix | What each of the 12 steps is *for*; the dark-mode counterparts when that opportunity lands. | Free — radix-ui.com/colors |
| Practical Typography | Matthew Butterick | Line length, point size, spacing verdicts when type looks off. | Free — practicaltypography.com |
| Practical UI | Adham Dannaway | Rule-driven UI decisions (forms, buttons, copy) when a call needs a second source. | Paid — practical-ui.com |
| Fluent 2 / Windows app design | Microsoft | Windows-side conventions; the notification-area rules (Win32 UX guide — still the official word). | Free — fluent2.microsoft.design, learn.microsoft.com/windows/apps/design |
| GNOME HIG | GNOME | Linux conventions. Note: deliberately **no** tray guidance — GNOME removed status icons; the platform gap is real and recorded in checklist §6. | Free — developer.gnome.org/hig |
| Electron Tray docs | Electron | The cross-platform tray constraints (template images, ICO, Linux caveats). | Free — electronjs.org/docs/latest/api/tray |
| NN/g 10 Usability Heuristics (+ empty-state & error-message articles) | Nielsen Norman Group | The evaluation vocabulary of checklist §3. | Free — nngroup.com |
| DTCG Format Module (2025.10) | W3C Design Tokens CG | The tokens.json format design.tokens.json follows. | Free — designtokens.org |

## Background (frames the whole; read once)

| Source | Author | Why it's here | Access |
|---|---|---|---|
| Calm Technology | Amber Case | The periphery-first principle a tray timer embodies; checklist §6's calm bar. | Free principles — calmtech.com (book paid) |
| Laws of UX | Jon Yablonski | The why behind the heuristics (Fitts, Hick, aesthetic-usability). | Free — lawsofux.com |
| The Design of Everyday Things | Don Norman | Affordances, feedback, mapping — the foundation under all of it. | Paid (book) |
| Component Driven / Storybook testing docs | Chromatic team | "Every state is a story" — the engineering realization of state coverage. | Free — componentdriven.org |
| 7 Rules for Creating Gorgeous UI | Erik Kennedy | The classic articles version of Refactoring UI's method. | Free — learnui.design |
| Invisible Details of Interaction Design | Rauno Freiberg | The qualitative companion to the §4 checklist. | Free — rauno.me/craft/interaction-design |
