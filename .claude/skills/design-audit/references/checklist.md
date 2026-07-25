# Design-audit checklist

The working checklist for phase 1. Items are checkable — each names what to
look at and what failure looks like. Findings cite the item or a
`design.html` rule id. Sources for every family are in `corpus.md`.

## 1. Spec floors (binding — violations are defects, not opinions)

- [ ] **Tokens only** (D01): no raw hex/scale-step in any surface; generated
      blocks untouched between markers (D02).
- [ ] **Colour roles** (D04): each token only in its documented role; `faint`
      never readable text; accent text only on permitted surfaces.
- [ ] **Contrast floors** (A01/A02): spot-check *rendered* pairs the computed
      check can't see (text over images/bands, disabled-looking-but-enabled).
- [ ] **Targets** (A03): every interactive element ≥24×24px or spacing-exempt —
      measure the smallest (calendar checkboxes, kebabs, tag removers).
- [ ] **Focus** (A04): tab through every view; ring visible on every stop,
      never fully obscured; focus order follows the visual order.
- [ ] **Pairing** (A05): every colour-borne state has a word or icon beside it.
- [ ] **Spacing grid** (D07): measure real paddings/gaps — legal values
      2, 4, 8, 12, 16…; misalignment usually starts as an off-grid value.
- [ ] **Accent discipline** (D11): count accent-solid fills per view — more
      than one is a defect; zero on a view with a clear primary is questionable.
- [ ] **Selection idiom** (D12): chosen things lift; nothing turns accent
      merely from being selected.
- [ ] **Type ramp** (D06): no rogue sizes/weights outside the five roles; every
      duration in tnum mono; readable text ≥11px.
- [ ] **Elevation** (D09): one rung above what it covers; no nested cards; no
      tinted boxes standing in for depth.
- [ ] **Motion** (D10/A06): ~120ms, meaningful only; reduced-motion collapses it.

## 2. States (walk STATES.md — every cell, not just ideal)

- [ ] Every view's **empty** state: designed, not a blank region; says what the
      view will hold and how to get the first item (empty ≠ broken).
- [ ] Every **error** state: the message names what happened and what to do,
      at the point of action; advisory (warn) never dressed as refusal (err).
- [ ] **Edge** states: longest-plausible text (client names, descriptions),
      0/1/many, overnight spans, overlap pileups — nothing truncates silently
      or misaligns.
- [ ] State transitions: nothing flashes, jumps, or reflows more than it must.

## 3. Heuristics (NN/g, timer-app slant)

- [ ] **Visibility of system status** — *the* heuristic for a tracker: is the
      running state unmissable everywhere (window, strip, popover, tray icon)?
- [ ] Match to the real world: the words are the glossary's, not the schema's.
- [ ] User control: every destructive action gated (two-step or confirm) and
      every gate reversible until confirmed.
- [ ] Consistency: same action, same affordance, same place in every view.
- [ ] Recognition over recall: pickers and favorites surface what typing would
      require remembering.
- [ ] Minimalist: every element earns its pixels; anything explainable only by
      prose is a redesign candidate.

## 4. Craft micro-details (interface-craft distillation)

- [ ] Hover states exist on everything clickable, and only on clickable things.
- [ ] Clickable text reads clickable (the neutral-button convention); inert
      text never does.
- [ ] Keyboard: Enter submits the focused form; Esc closes/cancels the
      innermost thing; shortcuts don't collide with system ones.
- [ ] Optical alignment: icons vertically centered against text; numerals
      aligned in columns; baselines, not bounding boxes.
- [ ] Text over anything non-uniform is legible (bands, hatches, gradients).
- [ ] No layout shift on hover/selection (borders that appear reserve space).
- [ ] Truncation is deliberate: ellipsis + full value reachable (title/tooltip).
- [ ] Copy: sentence case, no jargon, verbs on buttons ("Merge entries", never
      "OK"); the message names the object it's about.

## 5. Visual hierarchy (Refactoring UI distillation)

- [ ] Squint test per view: the eye lands on the view's one primary thing.
- [ ] Hierarchy from size/weight/space — not colour, boxes, or lines; if a
      border separates two things, ask if space could instead.
- [ ] Labels don't compete with data: values strong, labels caption-weight.
- [ ] Whitespace before rules; a divider is the last resort.
- [ ] Shadows consistent with one light source; the ladder, not ad-hoc blur.

## 6. Platform grammar (desktop tray utility)

- [ ] macOS menu-bar extra: monochrome template icon; the popover is the tray
      surface; the tray is never the *only* path to critical function.
- [ ] Windows notification area: distinct outline icon; survives being demoted
      to the overflow tray.
- [ ] Linux: StatusNotifier availability varies by desktop — the app degrades
      gracefully when there is no tray at all.
- [ ] System font stacks render (no web-font flash); native window chrome
      conventions respected; title bar follows system light/dark.
- [ ] Calm-technology bar: the app lives in the periphery — nothing animates,
      badges, or notifies beyond what the user configured.
