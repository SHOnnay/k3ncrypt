'use strict';

const { randomBytes } = require('crypto');
const { performance } = require('perf_hooks');
const { argon2id } = require('hash-wasm');

const parameters = { memorySize: 19_456, iterations: 2, parallelism: 1, hashLength: 32 };

async function main() {
  const samples = [];
  for (let index = 0; index < 5; index += 1) {
    const start = performance.now();
    await argon2id({
      password: 'benchmark-only-unlock-secret',
      salt: randomBytes(16),
      ...parameters,
      outputType: 'binary',
    });
    samples.push(performance.now() - start);
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const median = sorted[Math.floor(sorted.length / 2)];
  process.stdout.write(JSON.stringify({
    algorithm: 'Argon2id',
    memoryKiB: parameters.memorySize,
    memoryMiB: parameters.memorySize / 1024,
    iterations: parameters.iterations,
    parallelism: parameters.parallelism,
    samplesMs: samples.map((sample) => Number(sample.toFixed(1))),
    medianMs: Number(median.toFixed(1)),
    runtime: process.version,
    platform: `${process.platform}-${process.arch}`,
  }, null, 2));
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
