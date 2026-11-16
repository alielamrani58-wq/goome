import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMeters, estimateFare, rankAvailableDrivers, transitionRide } from '../src/index.ts';

const pickup = { latitude: 48.8566, longitude: 2.3522 };
const passenger = { id: 'passenger-a', role: 'passenger' };
const driver = { id: 'driver-a', role: 'driver' };
const requested = () => ({ id: 'ride-a', passengerId: passenger.id, driverId: null, status: 'requested', version: 0 });

test('an assigned driver can perform the complete trip sequence', () => {
  let ride = requested();
  for (const [action, expected] of [['accept', 'accepted'], ['arrive', 'arrived'], ['start', 'in_progress'], ['complete', 'completed']]) {
    ride = transitionRide(ride, driver, action, ride.version);
    assert.equal(ride.status, expected);
    assert.equal(ride.driverId, driver.id);
  }
  assert.equal(ride.version, 4);
  assert.throws(() => transitionRide(ride, passenger, 'cancel', 4), /already finished/);
});

test('another driver, passenger, and stale update cannot hijack a ride', () => {
  const ride = transitionRide(requested(), driver, 'accept', 0);
  assert.throws(() => transitionRide(ride, { id: 'driver-b', role: 'driver' }, 'arrive', 1), /assigned driver/);
  assert.throws(() => transitionRide(ride, passenger, 'start', 1), /assigned driver/);
  assert.throws(() => transitionRide(ride, driver, 'arrive', 0), /has changed/);
  assert.throws(() => transitionRide(ride, driver, 'complete', 1), /step yet/);
  assert.throws(() => transitionRide(requested(), { id: passenger.id, role: 'driver' }, 'accept', 0), /eligible driver/);
});

test('cancellation is restricted to the participants or an administrator', () => {
  const ride = transitionRide(requested(), driver, 'accept', 0);
  assert.equal(transitionRide(ride, passenger, 'cancel', 1).status, 'passenger_cancelled');
  assert.equal(transitionRide(ride, driver, 'cancel', 1).status, 'driver_cancelled');
  assert.throws(() => transitionRide(ride, { id: 'other', role: 'passenger' }, 'cancel', 1), /another account/);
  const inProgress = { ...ride, status: 'in_progress' };
  assert.throws(() => transitionRide(inProgress, passenger, 'cancel', 1), /Contact support/);
  assert.equal(transitionRide(inProgress, { id: 'admin-a', role: 'admin' }, 'cancel', 1).status, 'admin_cancelled');
});

test('dispatch excludes stale, unapproved, busy, offline, inaccurate and out-of-range drivers', () => {
  const now = 1_000_000;
  const eligible = { id: 'eligible', approved: true, online: true, activeRideId: null, position: pickup, locationRecordedAt: now, accuracyMeters: 5 };
  const drivers = [
    eligible,
    { ...eligible, id: 'stale', locationRecordedAt: now - 60_000 },
    { ...eligible, id: 'future', locationRecordedAt: now + 1 },
    { ...eligible, id: 'pending', approved: false },
    { ...eligible, id: 'busy', activeRideId: 'another-ride' },
    { ...eligible, id: 'offline', online: false },
    { ...eligible, id: 'inaccurate', accuracyMeters: 200 },
    { ...eligible, id: 'invalid', position: { latitude: NaN, longitude: 2 } },
    { ...eligible, id: 'far-away', position: { latitude: 51.5074, longitude: -0.1278 } },
  ];
  assert.deepEqual(rankAvailableDrivers(pickup, drivers, { now, radiusMeters: 5_000, maxLocationAgeMs: 30_000, maxAccuracyMeters: 50 }), [{ driverId: 'eligible', distanceMeters: 0 }]);
});

test('distance handles the international date line and rejects invalid GPS', () => {
  const distance = distanceMeters({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 });
  assert.ok(distance > 220 && distance < 224);
  assert.throws(() => distanceMeters(pickup, { latitude: 91, longitude: 0 }), /valid latitude/);
});

test('fares use road distance, integer money, supplied rates and a minimum', () => {
  const rules = { currency: 'EUR', baseMinor: 250, perKilometerMinor: 150, perMinuteMinor: 25, minimumMinor: 600 };
  assert.deepEqual(estimateFare(5_000, 600, rules), { amountMinor: 1250, currency: 'EUR' });
  assert.equal(estimateFare(0, 0, rules).amountMinor, 600);
  assert.throws(() => estimateFare(-1, 10, rules), /nonnegative/);
  assert.throws(() => estimateFare(10, 10, { ...rules, currency: 'euros' }), /currency code/);
  assert.throws(() => estimateFare(10, 10, { ...rules, baseMinor: 2.5 }), /integer minor units/);
});
