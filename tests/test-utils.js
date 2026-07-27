/**
 * Dependency-free browser test utilities.
 */

import { createHarnessDiagnostics } from "./harness-diagnostics.js";

const DEFAULT_TEST_TIMEOUT_MS = 60_000;

/** @type {{ name: string, tests: Array<{ name: string, fn: Function, expectedErrors: string[] }> }[]} */
const suites = [];

/** @type {{ name: string, tests: Array<{ name: string, fn: Function }> } | null} */
let currentSuite = null;

/**
 * @param {string} name
 * @param {() => void} fn
 */
export function describe(name, fn) {
  const suite = { name, tests: [] };
  suites.push(suite);
  const prev = currentSuite;
  currentSuite = suite;
  try {
    fn();
  } finally {
    currentSuite = prev;
  }
}

/**
 * @param {string} name
 * @param {() => unknown | Promise<unknown>} fn
 * @param {{ expectedErrors?: string[] }} [options]
 */
export function test(name, fn, options = {}) {
  if (!currentSuite) {
    throw new Error(`test("${name}") called outside describe()`);
  }
  currentSuite.tests.push({
    name,
    fn,
    expectedErrors: Array.isArray(options.expectedErrors)
      ? [...options.expectedErrors]
      : [],
  });
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
export function assertEqual(actual, expected, message) {
  if (!Object.is(actual, expected)) {
    throw new Error(message || `Expected ${repr(expected)}, got ${repr(actual)}`);
  }
}

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} [epsilon]
 * @param {string} [message]
 */
export function assertApproxEqual(actual, expected, epsilon = 1e-6, message) {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) {
    throw new Error(message || `Non-finite compare: ${actual} vs ${expected}`);
  }
  if (Math.abs(actual - expected) > epsilon) {
    throw new Error(
      message || `Expected ≈ ${expected} (±${epsilon}), got ${actual}`,
    );
  }
}

/**
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [message]
 */
export function assertDeepEqual(actual, expected, message) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) {
    throw new Error(message || `Deep equal failed.\nExpected: ${b}\nActual: ${a}`);
  }
}

/**
 * @param {Function} fn
 * @param {RegExp | string} [match]
 * @param {string} [message]
 */
export function assertThrows(fn, match, message) {
  let threw = false;
  /** @type {unknown} */
  let error;
  try {
    fn();
  } catch (err) {
    threw = true;
    error = err;
  }
  if (!threw) {
    throw new Error(message || "Expected function to throw");
  }
  if (match) {
    const text = error instanceof Error ? error.message : String(error);
    const ok = typeof match === "string" ? text.includes(match) : match.test(text);
    if (!ok) {
      throw new Error(message || `Thrown error did not match ${match}: ${text}`);
    }
  }
}

/** @param {unknown} value */
function repr(value) {
  if (typeof value === "string") return JSON.stringify(value);
  return String(value);
}

/**
 * @returns {Promise<{ passed: number, failed: number, results: Array<object> }>}
 */
export async function runAllTests(options = {}) {
  let passed = 0;
  let failed = 0;
  /** @type {Array<object>} */
  const results = [];
  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Number(options.timeoutMs)
    : DEFAULT_TEST_TIMEOUT_MS;
  const diagnostics = createHarnessDiagnostics();
  globalThis.__TEST_HARNESS_STATE__ = diagnostics;

  try {
    for (const suite of suites) {
      for (const t of suite.tests) {
        const start = performance.now();
        const fullName = `${suite.name} — ${t.name}`;
        const unexpectedStart = diagnostics.unexpected.length;
        diagnostics.setCurrentTest({
          fullName,
          startedAtMs: start,
          expectedErrors: t.expectedErrors,
        });
        options.onTestStart?.({
          suite: suite.name,
          name: t.name,
          startedAtMs: start,
          expectedErrors: t.expectedErrors,
        });
        let timeoutId;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            timeoutId = diagnostics.original.setTimeout(() => {
              const snapshot = diagnostics.snapshot();
              const error = new Error(
                `Test timed out after ${timeoutMs} ms: ${fullName}\n`
                + JSON.stringify(snapshot, null, 2),
              );
              error.code = "TEST_TIMEOUT";
              reject(error);
            }, timeoutMs);
          });
          await new Promise((resolve) => diagnostics.original.setTimeout(resolve, 0));
          await Promise.race([Promise.resolve().then(() => t.fn()), timeoutPromise]);
          diagnostics.original.clearTimeout(timeoutId);
          const observed = diagnostics.unexpected.slice(unexpectedStart);
          const classified = diagnostics.classifyErrors(observed, t.expectedErrors);
          if (classified.unexpected.length > 0) {
            throw new Error(
              `Unexpected browser errors during ${fullName}:\n`
              + JSON.stringify(classified.unexpected, null, 2),
            );
          }
          passed += 1;
          const result = {
            suite: suite.name,
            name: t.name,
            ok: true,
            startedAtMs: start,
            completedAtMs: performance.now(),
            ms: performance.now() - start,
            expectedErrorCategories: t.expectedErrors,
            observedExpectedErrors: classified.expected,
          };
          results.push(result);
          options.onTestComplete?.(result);
        } catch (err) {
          diagnostics.original.clearTimeout(timeoutId);
          failed += 1;
          const result = {
            suite: suite.name,
            name: t.name,
            ok: false,
            startedAtMs: start,
            completedAtMs: performance.now(),
            ms: performance.now() - start,
            error: err instanceof Error ? (err.stack || err.message) : String(err),
          };
          results.push(result);
          options.onTestComplete?.(result);
        } finally {
          diagnostics.cleanupTest(fullName);
        }
      }
    }
  } finally {
    diagnostics.restore();
  }

  const runResult = {
    passed,
    failed,
    results,
    diagnostics: diagnostics.snapshot(),
  };
  globalThis.__TEST_RUN_RESULTS__ = runResult;
  return runResult;
}

export function getSuites() {
  return suites;
}
