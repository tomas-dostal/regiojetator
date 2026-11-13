import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UserError } from '../errors.mjs';
import { parseSeats, normalizeSeats, assertNotDeparted, resolveCity, validateCar, layoutName, getLayout } from '../regiojet.mjs';
import { parseSelection } from '../browser.mjs';

test('parseSeats handles ranges, lists and mixes', () => {
  assert.deepEqual(parseSeats('31-36'), [31, 32, 33, 34, 35, 36]);
  assert.deepEqual(parseSeats('36, 31,33-34'), [31, 33, 34, 36]);
  assert.deepEqual(parseSeats('5,5'), [5]);
});

test('parseSeats rejects bad input', () => {
  for (const bad of ['', 'abc', '3-1', '1-7', '1,2,3,4,5,6,7', '0']) {
    assert.throws(() => parseSeats(bad), UserError, bad);
  }
});

test('normalizeSeats and validateCar enforce limits', () => {
  assert.deepEqual(normalizeSeats([3, 1, 3]), [1, 3]);
  assert.throws(() => normalizeSeats([]), UserError);
  assert.throws(() => normalizeSeats([1.5]), UserError);
  assert.throws(() => normalizeSeats('1'), UserError);
  assert.equal(validateCar(3), 3);
  assert.throws(() => validateCar(0), UserError);
  assert.throws(() => validateCar(41), UserError);
});

test('assertNotDeparted refuses departed trains but honours delay', () => {
  const now = new Date('2026-11-19T07:00:00Z');
  const past = new Date('2026-11-19T06:00:00Z');
  const future = new Date('2026-11-19T08:00:00Z');
  assert.throws(() => assertNotDeparted({ effective: past }, now), UserError);
  assert.doesNotThrow(() => assertNotDeparted({ scheduled: past, predicted: future, effective: future }, now));
});

test('resolveCity: exact, prefix, ambiguous, unknown, empty', async () => {
  const realFetch = globalThis.fetch;
  const cities = ['Praha', 'Pardubice', 'Košice', 'Brno'].map((name, id) => ({ id, name }));
  globalThis.fetch = async () => new Response(JSON.stringify([{ cities }]), { status: 200 });
  try {
    assert.equal((await resolveCity('kosice')).name, 'Košice');
    assert.equal((await resolveCity('Pra')).name, 'Praha');
    await assert.rejects(resolveCity('P'), /nejednoznačné/);
    await assert.rejects(resolveCity('Zzz'), /nenašel/);
    await assert.rejects(resolveCity('  '), /Zadej/);
    await assert.rejects(resolveCity(undefined), /Zadej/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('parseSelection reads the summary panel without gluing the passenger count', () => {
  const text = 'Standard (2. tř.)\nVůz 3, Sedadlo 31,32,33,34,35,36\n6× Dospělý 18-64 let';
  assert.deepEqual([...parseSelection(text)], ['3:31', '3:32', '3:33', '3:34', '3:35', '3:36']);
  const two = 'Vůz 2, Sedadlo 2, 3 Vůz 3, Sedadlo 31\n2× Dospělý';
  assert.deepEqual([...parseSelection(two)].sort(), ['2:2', '2:3', '3:31']);
  assert.equal(parseSelection('nothing here').size, 0);
});

test('layoutName accepts only svg files under the official layout path', async () => {
  const base = 'https://brn-ybus-pubapi.sa.cz/resources/vehicle_layout/';
  assert.equal(layoutName(base + 'vlak_vuz-bk-42_flipped.svg'), 'vlak_vuz-bk-42_flipped.svg');
  for (const bad of [null, undefined, '', 'https://evil.test/a.svg', base + '../x.svg', base + 'a.html', base + 'a/b.svg', base]) {
    assert.equal(layoutName(bad), null, String(bad));
  }
  await assert.rejects(getLayout('../etc.svg'), UserError);
});
