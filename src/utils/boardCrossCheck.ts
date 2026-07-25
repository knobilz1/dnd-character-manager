/**
 * boardCrossCheck.ts — comparing two engines' reads of the same table photo.
 *
 * Lifted out of DMConsolePage so it can actually be executed against real reads.
 * It lived as a closure inside a 5,000-line component, which meant the one thing
 * that could go wrong here — matching the wrong pieces to each other — could only
 * ever be reviewed by eye. It had already been wrong once (a tie counted as a
 * disagreement, turning a correct row amber).
 *
 * This never overrules the first read. A single reader measured 4/8 exact on an
 * angled shot with about a cell of run-to-run variance, and the failure mode is
 * silent: a wrong square looks exactly like a right one. Two readers can't fix
 * that, but they can say WHICH squares to look at.
 */

export interface ReadPiece {
  cell: string;
  description: string;
}

/** Words shared between two descriptions, case- and punctuation-insensitive. */
function overlap(mine: string[], other: string): number {
  const words = new Set(normalize(other).split(' ').filter(Boolean));
  return mine.filter((w) => words.has(w)).length;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

/**
 * Indices into `first` whose square the second reader placed differently.
 *
 * Matched by DESCRIPTION, not by position: the two engines list pieces in
 * whatever order they like, so pairing by index would compare a goblin to a
 * treasure chest and report both as disputed.
 *
 * A tie is deliberately NOT a dispute. Three tokens all described as "<colour>
 * circular token" overlap on two words each, so the best match is unattributable
 * — and one piece the reviewer simply didn't list makes its nearest neighbour
 * light up amber. A warning about a row that was right is worse than no warning,
 * because the DM stops trusting the amber ones that matter.
 */
export function disputedCells(first: ReadPiece[], second: ReadPiece[]): number[] {
  const disputed: number[] = [];
  first.forEach((piece, i) => {
    const mine = normalize(piece.description).split(' ').filter(Boolean);
    let best: { cell: string; score: number } | null = null;
    let runnerUp = 0;
    for (const other of second) {
      const score = overlap(mine, other.description);
      if (!best || score > best.score) {
        runnerUp = best?.score ?? 0;
        best = { cell: other.cell, score };
      } else if (score > runnerUp) {
        runnerUp = score;
      }
    }
    if (
      best &&
      best.score > 0 &&
      best.score > runnerUp &&
      best.cell.toUpperCase() !== piece.cell.toUpperCase()
    ) {
      disputed.push(i);
    }
  });
  return disputed;
}
