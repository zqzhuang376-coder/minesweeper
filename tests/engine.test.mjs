import test from "node:test";
import assert from "node:assert/strict";
import { Minesweeper } from "../dist/engine.js";

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function neighbors(rows, cols, index) {
  const row = Math.floor(index / cols);
  const col = index % cols;
  return Array.from({ length: rows * cols }, (_, candidate) => candidate)
    .filter((candidate) =>
      candidate !== index &&
      Math.abs(Math.floor(candidate / cols) - row) <= 1 &&
      Math.abs(candidate % cols - col) <= 1
    );
}

// Controlled mine layouts isolate rule behavior from random placement.
function fixture(rows, cols, mines) {
  const game = new Minesweeper(rows, cols, mines.length);
  const mineSet = new Set(mines);
  game.cells.forEach((cell, index) => {
    cell.mine = mineSet.has(index);
    cell.adjacent = neighbors(rows, cols, index)
      .filter((neighbor) => mineSet.has(neighbor)).length;
  });
  game.status = "playing";
  return game;
}

test("a new game has independent, empty cells and does not place mines for flags", () => {
  const game = new Minesweeper(9, 9, 10, () => 0);
  assert.equal(game.status, "ready");
  assert.equal(game.cells.length, 81);
  assert.equal(game.flaggedCount, 0);
  assert.equal(game.revealedCount, 0);
  assert.notEqual(game.cells[0], game.cells[1]);
  assert.deepEqual(game.toggleFlag(40), { changed: true, status: "ready" });
  assert.equal(game.flaggedCount, 1);
  assert.deepEqual(game.reveal(40), { changed: false, status: "ready" });
  assert.equal(game.cells.filter((cell) => cell.mine).length, 0);
  assert.deepEqual(game.toggleFlag(40), { changed: true, status: "ready" });
  assert.equal(game.flaggedCount, 0);
});

for (const [name, rows, cols, count] of [
  ["beginner", 9, 9, 10],
  ["intermediate", 16, 16, 40],
  ["expert", 16, 30, 99],
]) {
  test(`${name}: first opening and all neighbors are safe, with exact mine counts`, () => {
    for (const first of [0, cols - 1, Math.floor(rows / 2) * cols + Math.floor(cols / 2),
      (rows - 1) * cols, rows * cols - 1]) {
      const game = new Minesweeper(rows, cols, count, seededRandom(first + 17));
      const result = game.reveal(first);
      assert.equal(result.changed, true);
      assert.notEqual(game.status, "lost");
      assert.equal(game.cells[first].adjacent, 0);
      assert.equal(game.cells.filter((cell) => cell.mine).length, count);
      for (const index of [first, ...neighbors(rows, cols, first)]) {
        assert.equal(game.cells[index].mine, false, `first opening includes mine ${index}`);
        assert.equal(game.cells[index].revealed, true);
      }
      game.cells.forEach((cell, index) => {
        assert.equal(cell.adjacent, neighbors(rows, cols, index)
          .filter((neighbor) => game.cells[neighbor].mine).length);
      });
    }
  });
}

test("constant randomness still places all mines without retry loops", () => {
  const game = new Minesweeper(16, 30, 99, () => 0);
  game.reveal(225);
  assert.equal(game.cells.filter((cell) => cell.mine).length, 99);
  assert.equal(game.cells[225].adjacent, 0);
});

test("flood opening expands through empty cells and numbers but protects flags", () => {
  const game = fixture(5, 5, [0, 4, 20, 24]);
  game.toggleFlag(12);
  game.reveal(11);
  assert.equal(game.cells[12].revealed, false);
  assert.equal(game.cells[12].flagged, true);
  assert.equal(game.revealedCount, 20);
  assert.equal(game.status, "playing");
  assert.equal(game.cells.filter((cell) => cell.revealed && cell.mine).length, 0);
  assert.equal(game.cells[1].revealed, true);
  game.toggleFlag(12);
  assert.deepEqual(game.reveal(12), { changed: true, status: "won" });
  assert.equal(game.revealedCount, 21);
  assert.equal(game.flaggedCount, 4);
  assert.ok(game.cells.filter((cell) => cell.mine).every((cell) => cell.flagged));
});

test("revealing a numbered cell does not expand beyond it", () => {
  const game = fixture(5, 5, [0]);
  assert.deepEqual(game.reveal(1), { changed: true, status: "playing" });
  assert.equal(game.revealedCount, 1);
  assert.equal(game.cells[1].adjacent, 1);
  assert.deepEqual(game.reveal(1), { changed: false, status: "playing" });
  assert.deepEqual(game.toggleFlag(1), { changed: false, status: "playing" });
});

test("revealing a mine loses and freezes all actions", () => {
  const game = fixture(5, 5, [0, 24]);
  game.reveal(1);
  assert.deepEqual(game.reveal(0), { changed: true, status: "lost" });
  assert.equal(game.cells[0].revealed, true);
  assert.equal(game.revealedCount, 1);
  const before = structuredClone(game.cells);
  for (const method of ["reveal", "toggleFlag", "chord"]) {
    assert.deepEqual(game[method](23), { changed: false, status: "lost" });
  }
  assert.deepEqual(game.cells, before);
});

test("a win freezes the board and auto-flags the remaining mines", () => {
  const game = fixture(5, 5, [0, 4, 20, 24]);
  game.toggleFlag(0);
  game.reveal(12);
  assert.equal(game.status, "won");
  assert.equal(game.revealedCount, 21);
  assert.equal(game.flaggedCount, 4);
  const before = structuredClone(game.cells);
  for (const method of ["reveal", "toggleFlag", "chord"]) {
    assert.deepEqual(game[method](0), { changed: false, status: "won" });
  }
  assert.deepEqual(game.cells, before);
});

test("chording requires the correct flag count and opens adjacent safe cells", () => {
  const game = fixture(5, 5, [0, 4, 20, 24]);
  assert.deepEqual(game.chord(6), { changed: false, status: "playing" });
  game.reveal(6);
  assert.deepEqual(game.chord(6), { changed: false, status: "playing" });
  assert.equal(game.revealedCount, 1);
  game.toggleFlag(0);
  assert.deepEqual(game.chord(6), { changed: true, status: "won" });
  assert.equal(game.revealedCount, 21);
});

test("the right number of incorrectly positioned flags makes a chord lose", () => {
  const game = fixture(5, 5, [0, 4, 20, 24]);
  game.reveal(6);
  game.toggleFlag(1);
  assert.deepEqual(game.chord(6), { changed: true, status: "lost" });
  assert.equal(game.cells[0].revealed, true);
  assert.equal(game.cells[1].flagged, true);
  assert.equal(game.cells[1].revealed, false);
});

test("too many flags prevent a chord", () => {
  const game = fixture(5, 5, [0, 4, 20, 24]);
  game.reveal(6);
  game.toggleFlag(0);
  game.toggleFlag(1);
  assert.deepEqual(game.chord(6), { changed: false, status: "playing" });
  assert.equal(game.revealedCount, 1);
});

test("neighbors never wrap from one row to the next", () => {
  const game = fixture(5, 5, [4]);
  game.toggleFlag(0);
  game.reveal(3);
  assert.equal(game.cells[3].adjacent, 1);
  assert.equal(game.cells[5].adjacent, 0);
  assert.deepEqual(game.chord(3), { changed: false, status: "playing" });
  assert.equal(game.revealedCount, 1);
});

test("invalid indices are harmless and never start a game", () => {
  const game = new Minesweeper(9, 9, 10);
  for (const index of [-1, 81, 1.5, NaN, Infinity, "2", null, undefined]) {
    for (const method of ["reveal", "toggleFlag", "chord"]) {
      assert.deepEqual(game[method](index), { changed: false, status: "ready" });
    }
  }
  assert.equal(game.revealedCount, 0);
  assert.equal(game.flaggedCount, 0);
});

test("a zero-mine game wins on first opening, including one-cell boards", () => {
  for (const [rows, cols] of [[1, 1], [1, 6], [6, 1], [3, 3]]) {
    const game = new Minesweeper(rows, cols, 0);
    assert.deepEqual(game.reveal(0), { changed: true, status: "won" });
    assert.equal(game.revealedCount, rows * cols);
    assert.equal(game.flaggedCount, 0);
  }
});

test("constructor rejects invalid dimensions and impossible safe-opening counts", () => {
  for (const args of [[0, 9, 0], [9, -1, 0], [2.5, 9, 0], [9, 9, -1],
    [9, 9, 1.5], [3, 3, 1], [9, 9, 73]]) {
    assert.throws(() => new Minesweeper(...args), RangeError);
  }
  assert.throws(() => new Minesweeper(9, 9, 10, null), TypeError);
});
