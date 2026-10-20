/**
 * Dependency-free Minesweeper rules.
 * `revealedCount` counts safe cells; a detonated mine has `revealed: true`
 * but does not contribute to that count.
 */
export class Minesweeper {
  constructor(rows, cols, mineCount, random = Math.random) {
    if (!Number.isInteger(rows) || rows < 1 ||
        !Number.isInteger(cols) || cols < 1) {
      throw new RangeError("Rows and columns must be positive integers.");
    }
    const maximumMines = rows * cols - Math.min(rows, 3) * Math.min(cols, 3);
    if (!Number.isInteger(mineCount) || mineCount < 0 || mineCount > maximumMines) {
      throw new RangeError("Mine count must leave room for a safe first opening.");
    }
    if (typeof random !== "function") {
      throw new TypeError("The random source must be a function.");
    }

    this.rows = rows;
    this.cols = cols;
    this.mineCount = mineCount;
    this.status = "ready";
    this.flaggedCount = 0;
    this.revealedCount = 0;
    this.cells = Array.from({ length: rows * cols }, () => ({
      mine: false,
      adjacent: 0,
      revealed: false,
      flagged: false,
    }));
    this.#random = random;
  }

  #random;

  #isValid(index) {
    return Number.isInteger(index) && index >= 0 && index < this.cells.length;
  }

  #isFinished() {
    return this.status === "won" || this.status === "lost";
  }

  #result(changed) {
    return { changed, status: this.status };
  }

  #neighbors(index) {
    const row = Math.floor(index / this.cols);
    const col = index % this.cols;
    const neighbors = [];
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dy === 0) continue;
        const y = row + dy;
        const x = col + dx;
        if (y >= 0 && y < this.rows && x >= 0 && x < this.cols) {
          neighbors.push(y * this.cols + x);
        }
      }
    }
    return neighbors;
  }

  #placeMines(firstIndex) {
    const excluded = new Set([firstIndex, ...this.#neighbors(firstIndex)]);
    const candidates = this.cells.map((_, index) => index)
      .filter((index) => !excluded.has(index));

    // Fisher–Yates has bounded runtime even with a constant random source.
    for (let i = candidates.length - 1; i > 0; i -= 1) {
      const j = Math.floor(this.#random() * (i + 1));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    for (const index of candidates.slice(0, this.mineCount)) {
      this.cells[index].mine = true;
    }
    for (const index of candidates.slice(0, this.mineCount)) {
      for (const neighbor of this.#neighbors(index)) {
        this.cells[neighbor].adjacent += 1;
      }
    }
    this.status = "playing";
  }

  #open(indices) {
    const pending = [...indices];
    let changed = false;

    while (pending.length > 0) {
      const index = pending.pop();
      const cell = this.cells[index];
      if (cell.revealed || cell.flagged) continue;

      cell.revealed = true;
      changed = true;
      if (cell.mine) {
        this.status = "lost";
        return changed;
      }

      this.revealedCount += 1;
      if (cell.adjacent === 0) {
        pending.push(...this.#neighbors(index));
      }
    }

    if (this.revealedCount === this.cells.length - this.mineCount) {
      this.status = "won";
      for (const cell of this.cells) {
        if (cell.mine && !cell.flagged) {
          cell.flagged = true;
          this.flaggedCount += 1;
        }
      }
    }
    return changed;
  }

  reveal(index) {
    if (!this.#isValid(index) || this.#isFinished()) return this.#result(false);
    const cell = this.cells[index];
    if (cell.flagged || cell.revealed) return this.#result(false);
    if (this.status === "ready") this.#placeMines(index);
    return this.#result(this.#open([index]));
  }

  toggleFlag(index) {
    if (!this.#isValid(index) || this.#isFinished()) return this.#result(false);
    const cell = this.cells[index];
    if (cell.revealed) return this.#result(false);
    cell.flagged = !cell.flagged;
    this.flaggedCount += cell.flagged ? 1 : -1;
    return this.#result(true);
  }

  chord(index) {
    if (!this.#isValid(index) || this.#isFinished()) return this.#result(false);
    const cell = this.cells[index];
    if (!cell.revealed || cell.mine || cell.adjacent === 0) {
      return this.#result(false);
    }
    const neighbors = this.#neighbors(index);
    const flags = neighbors.filter((neighbor) => this.cells[neighbor].flagged).length;
    if (flags !== cell.adjacent) return this.#result(false);
    const targets = neighbors.filter((neighbor) => {
      const target = this.cells[neighbor];
      return !target.revealed && !target.flagged;
    });
    if (targets.length === 0) return this.#result(false);
    return this.#result(this.#open(targets));
  }
}
