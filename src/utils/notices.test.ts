import { describe, it, expect } from 'vitest';
import { pushNotice, dismissNotice, MAX_NOTICES, type Notice } from './notices';

/** Builds a list the way the console does — one push at a time, ids increasing. */
function build(...items: [Notice['kind'], string | null][]): Notice[] {
  let list: Notice[] = [];
  let id = 0;
  for (const [kind, text] of items) list = pushNotice(list, kind, text, ++id);
  return list;
}
const texts = (l: Notice[]) => l.map((n) => n.text);

describe('keeping what the single slot used to lose', () => {
  /** The bug: a failed map render followed by a failed memory write showed only
   *  the memory write, and the map failure was gone with nothing to notice. */
  it('keeps an earlier error when a second one arrives', () => {
    const list = build(['error', 'Map render failed'], ['error', 'Memory write failed']);
    expect(texts(list)).toEqual(['Map render failed', 'Memory write failed']);
  });

  it('keeps errors and warnings side by side', () => {
    const list = build(['warning', 'Chapter did not advance'], ['error', 'Engine died']);
    expect(list).toHaveLength(2);
    expect(list.map((n) => n.kind)).toEqual(['warning', 'error']);
  });

  it('gives every notice its own id so one can be dismissed', () => {
    const list = build(['error', 'a'], ['error', 'b'], ['warning', 'c']);
    expect(new Set(list.map((n) => n.id)).size).toBe(3);
    expect(texts(dismissNotice(list, list[1].id))).toEqual(['a', 'c']);
  });

  it('ignores a dismiss for an id that is not there', () => {
    const list = build(['error', 'a']);
    expect(dismissNotice(list, 999)).toEqual(list);
  });
});

describe('null still clears, the way setError(null) always did', () => {
  it('clears only its own kind', () => {
    const list = build(['error', 'boom'], ['warning', 'careful'], ['error', null]);
    expect(texts(list)).toEqual(['careful']);
  });

  it('clearing an empty list is harmless', () => {
    expect(pushNotice([], 'error', null, 1)).toEqual([]);
  });
});

describe('a failing poll must not bury the console', () => {
  /** Forty identical failures are one problem. Without this they would push every
   *  other message out of a list capped at four. */
  it('collapses a repeat instead of stacking it', () => {
    let list: Notice[] = [];
    for (let i = 0; i < 40; i++) list = pushNotice(list, 'error', 'Poll failed', i + 1);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('Poll failed');
  });

  /** The repeat moves to the end, so the newest occurrence is the one the DM's
   *  eye lands on — and its id changes, which is how React knows to re-render it. */
  it('moves a repeat to the end with a fresh id', () => {
    const list = build(['error', 'first'], ['error', 'second'], ['error', 'first']);
    expect(texts(list)).toEqual(['second', 'first']);
    expect(list[1].id).toBe(3);
  });

  it('the same text under a different kind is a separate notice', () => {
    const list = build(['error', 'same'], ['warning', 'same']);
    expect(list).toHaveLength(2);
  });

  it(`never grows past ${MAX_NOTICES}, dropping the oldest`, () => {
    let list: Notice[] = [];
    for (let i = 0; i < 10; i++) list = pushNotice(list, 'error', `problem ${i}`, i + 1);
    expect(list).toHaveLength(MAX_NOTICES);
    expect(texts(list)).toEqual(['problem 6', 'problem 7', 'problem 8', 'problem 9']);
  });
});
