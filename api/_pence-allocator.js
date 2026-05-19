// Pence-allocation helper. Step 0.5 of PER-INSTRUCTOR-CREDITS-PLAN.md.
//
// Sole rounding rule for splitting an integer pence total across weighted
// shares. Use this wherever you'd otherwise reach for Math.floor + ad-hoc
// remainder handling — Step 4g's FIFO fee math depends on every allocator
// site producing the same answer.
//
// Algorithm: Hamilton / largest-remainder method.
//   1. Each share gets floor(total * weight / sumWeights).
//   2. Compute each share's fractional remainder, represented exactly as
//      (total * weight) mod sumWeights so the comparison stays in integer
//      arithmetic.
//   3. Distribute the leftover pence one at a time to the shares with the
//      largest remainders. Ties broken by lowest index (deterministic).
//
// Deterministic outputs (from PER-INSTRUCTOR-CREDITS-PLAN.md Step 0.5
// acceptance criteria):
//   allocate(100, [1, 1, 1]) → [34, 33, 33]
//   allocate(100, [2, 1])    → [67, 33]
//
// The "lowest index wins on ties" rule means equal-weight allocations
// concentrate the remainder pence at the FRONT of the array. api/offers.js
// relies on this to keep the rounding remainder on a booked lesson rather
// than orphaned onto an unbooked week.
//
// Invariants enforced by the implementation:
//   - Output length === weights.length.
//   - sum(output) === totalPence, exactly.
//   - totalPence === 0 → all-zero array (handles the "no fee snapshotted yet"
//     case gracefully).
//   - All weights must be non-negative integers; at least one must be > 0.

function allocate(totalPence, weights) {
  if (!Number.isInteger(totalPence)) {
    throw new TypeError(`allocate: totalPence must be an integer, got ${totalPence}`);
  }
  if (!Array.isArray(weights) || weights.length === 0) {
    throw new TypeError('allocate: weights must be a non-empty array');
  }
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isInteger(w) || w < 0) {
      throw new TypeError(`allocate: weights[${i}] must be a non-negative integer, got ${w}`);
    }
  }

  const n = weights.length;
  const sumWeights = weights.reduce((a, b) => a + b, 0);
  if (sumWeights === 0) {
    throw new RangeError('allocate: weights must include at least one positive value');
  }

  // Zero total → zero everywhere. Skips the negative-pence corner case too,
  // since totalPence < 0 falls through to the same floor/remainder maths and
  // produces a valid (signed) allocation — but Step 0.5 callers never pass
  // negative pence in practice.
  if (totalPence === 0) {
    return new Array(n).fill(0);
  }

  // signedTotal lets us handle negative pence sensibly (future-proof for
  // refund-rebook fee deltas in Step 5). The algorithm works on absolute
  // value, then re-signs.
  const sign = totalPence < 0 ? -1 : 1;
  const abs = Math.abs(totalPence);

  // floor(abs * weight / sumWeights) for each share. Stay in integer
  // arithmetic — JS numbers are IEEE-754 doubles but integer ops are exact
  // up to Number.MAX_SAFE_INTEGER (2^53), well above any realistic pence total.
  const shares = new Array(n);
  const remainders = new Array(n);
  let allocated = 0;
  for (let i = 0; i < n; i++) {
    const num = abs * weights[i];
    shares[i] = Math.floor(num / sumWeights);
    remainders[i] = num - shares[i] * sumWeights; // (abs * weight) mod sumWeights
    allocated += shares[i];
  }

  // Distribute leftover pence one by one to the largest-remainder share.
  // Lowest index wins ties — that's the deterministic rule offers.js depends
  // on. `leftover` is always in [0, n) so this loop is cheap.
  let leftover = abs - allocated;
  while (leftover > 0) {
    let bestIdx = 0;
    let bestRem = remainders[0];
    for (let i = 1; i < n; i++) {
      if (remainders[i] > bestRem) {
        bestIdx = i;
        bestRem = remainders[i];
      }
    }
    shares[bestIdx] += 1;
    remainders[bestIdx] = -1; // ineligible for future increments
    leftover -= 1;
  }

  if (sign === -1) {
    for (let i = 0; i < n; i++) shares[i] = -shares[i];
  }

  return shares;
}

module.exports = { allocate };
