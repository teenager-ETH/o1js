import type { Field } from '../field.js';
import type { Bool } from '../bool.js';
import { createBool, createField } from '../core/field-constructor.js';
import { Fp } from '../../../bindings/crypto/finite-field.js';
import { assert } from '../../../lib/util/assert.js';
import { exists } from '../core/exists.js';
import { assertMul } from './compatible.js';
import { asProver } from '../core/provable-context.js';
import { log2 } from '../../../bindings/crypto/bigint-helpers.js';

export {
  compareCompatible,
  checkRangesAsProver,
  assertLessThanGeneric,
  assertLessThanOrEqualGeneric,
};

/**
 * Prove x <= y assuming 0 <= x, y < c.
 * The constant c must satisfy 2c <= p, where p is the field order.
 *
 * Expects a function `rangeCheck(v: Field)` which proves that v is in [0, c).
 * The efficiency of the gadget largely depends on the efficiency of `rangeCheck()`.
 *
 * **Warning:** The gadget does not prove x <= y if either 2c > p or x or y are not in [0, c).
 * Neither of these conditions are enforced by the gadget.
 */
function assertLessThanOrEqualGeneric(
  x: Field,
  y: Field,
  rangeCheck: (v: Field) => void
) {
  // since 0 <= x, y < c, we have y - x in [0, c) u (p-c, p)
  // because of c <= p-c, the two ranges are disjoint. therefore,
  // y - x in [0, c) is equivalent to x <= y
  rangeCheck(y.sub(x).seal());
}

/**
 * Prove x < y assuming 0 <= x, y < c.
 *
 * See {@link assertLessThanOrEqualGeneric} for details and assumptions.
 */
function assertLessThanGeneric(
  x: Field,
  y: Field,
  rangeCheck: (v: Field) => void
) {
  // since 0 <= x, y < c, we have y - 1 - x in [0, c) u [p-c, p)
  // because of c <= p-c, the two ranges are disjoint. therefore,
  // y - 1 - x in [0, c) is equivalent to x <= y - 1 which is equivalent to x < y
  rangeCheck(y.sub(1).sub(x).seal());
}

/**
 * Check ranges in a prover block, to help users avoid the pitfall of using comparison gadgets
 * without range-checking the inputs.
 */
function checkRangesAsProver(x: Field, y: Field, c: bigint) {
  asProver(() => {
    let x0 = x.toBigInt();
    let y0 = y.toBigInt();
    if (x0 >= c || y0 >= c)
      throw Error(
        `Provable comparison can only be used on Fields <= ${log2(
          c
        )} bits, got ${Math.max(log2(x0), log2(y0))} bits.`
      );
  });
}

/**
 * Compare x and y assuming both have at most `n` bits.
 *
 * **Important:** If `x` and `y` have more than `n` bits, this doesn't prove the comparison correctly.
 * It is up to the caller to prove that `x` and `y` have at most `n` bits.
 *
 * **Warning:** This was created for 1:1 compatibility with snarky's `compare` gadget.
 * It was designed for R1CS and is extremeley inefficient when used with plonkish arithmetization.
 */
function compareCompatible(x: Field, y: Field, n = Fp.sizeInBits - 2) {
  let maxLength = Fp.sizeInBits - 2;
  assert(n <= maxLength, `bitLength must be at most ${maxLength}`);

  // as prover check
  const c = 1n << BigInt(n);
  checkRangesAsProver(x, y, c);

  // z = 2^n + y - x
  let z = createField(c).add(y).sub(x);

  let zBits = unpack(z, n + 1);

  // highest (n-th) bit tells us if z >= 2^n
  // which is equivalent to x <= y
  let lessOrEqual = zBits[n];

  // other bits tell us if x = y
  let prefix = zBits.slice(0, n);
  let notAllZeros = any(prefix);
  let less = lessOrEqual.and(notAllZeros);

  return { lessOrEqual, less };
}

// helper functions for `compareCompatible()`

// custom version of toBits to be compatible
function unpack(x: Field, length: number) {
  let bits = exists(length, () => {
    let x0 = x.toBigInt();
    return Array.from({ length }, (_, k) => (x0 >> BigInt(k)) & 1n);
  });
  bits.forEach((b) => b.assertBool());
  let lc = bits.reduce(
    (acc, b, i) => acc.add(b.mul(1n << BigInt(i))),
    createField(0)
  );
  assertMul(lc, createField(1), x);
  return bits.map((b) => createBool(b.value));
}

function any(xs: Bool[]) {
  let sum = xs.reduce((a, b) => a.add(b.toField()), createField(0));
  let allZero = isZero(sum);
  return allZero.not();
}

// custom isZero to be compatible
function isZero(x: Field): Bool {
  // create witnesses z = 1/x (or z=0 if x=0), and b = 1 - zx
  let [b, z] = exists(2, () => {
    let xmy = x.toBigInt();
    let z = Fp.inverse(xmy) ?? 0n;
    let b = Fp.sub(1n, Fp.mul(z, xmy));
    return [b, z];
  });
  // b * x === 0
  assertMul(b, x, createField(0));
  // z * x === 1 - b
  assertMul(z, x, createField(1).sub(b));
  return createBool(b.value);
}
