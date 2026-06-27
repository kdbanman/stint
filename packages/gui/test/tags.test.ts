/**
 * Unit — the pure tag-edit decision (PRD §07, §06 R1). The in-context GUI tag editor
 * gathers the user's edited chip set and lets `tagDiff` decide the minimal
 * addTags/removeTags the `edit` patch carries (Store.edit applies exactly those two
 * lists). We can't drive a real chip UI in CI (that visual behaviour is the JUDGE
 * TAG_CHIPS scene), but the decision it carries out is pure and proven here — mirroring
 * toggle.test.ts. The renderer's window.SU.tagDiff is a thin mirror of this same source.
 */
import { describe, it, expect } from 'vitest';
import { tagDiff } from '../src/tags.js';

describe('tagDiff — the minimal add/remove a tag edit sends', () => {
  it('adds only the genuinely new tags', () => {
    expect(tagDiff(['a'], ['a', 'b'])).toEqual({ addTags: ['b'], removeTags: [] });
  });

  it('removes only the dropped tags', () => {
    expect(tagDiff(['a', 'b'], ['a'])).toEqual({ addTags: [], removeTags: ['b'] });
  });

  it('handles a mixed add and remove in one edit', () => {
    expect(tagDiff(['a', 'b'], ['a', 'c'])).toEqual({ addTags: ['c'], removeTags: ['b'] });
  });

  it('is a no-op when the sets are identical', () => {
    expect(tagDiff(['a', 'b'], ['b', 'a'])).toEqual({ addTags: [], removeTags: [] });
  });

  it('treats an empty original (all new) and an empty next (all removed) as expected', () => {
    expect(tagDiff([], ['x', 'y'])).toEqual({ addTags: ['x', 'y'], removeTags: [] });
    expect(tagDiff(['x', 'y'], [])).toEqual({ addTags: [], removeTags: ['x', 'y'] });
  });

  it('compares case-insensitively — re-typing an existing tag in another case is a no-op', () => {
    expect(tagDiff(['Deep'], ['deep'])).toEqual({ addTags: [], removeTags: [] });
    expect(tagDiff(['Deep'], ['DEEP', 'urgent'])).toEqual({ addTags: ['urgent'], removeTags: [] });
  });

  it('de-duplicates the next set case-insensitively, keeping the first spelling', () => {
    expect(tagDiff([], ['Deep', 'deep', 'DEEP'])).toEqual({ addTags: ['Deep'], removeTags: [] });
  });

  it('trims whitespace and drops empty entries on both sides', () => {
    expect(tagDiff(['  a  '], ['a', '   ', '  b '])).toEqual({ addTags: ['b'], removeTags: [] });
    expect(tagDiff([''], [''])).toEqual({ addTags: [], removeTags: [] });
  });
});
