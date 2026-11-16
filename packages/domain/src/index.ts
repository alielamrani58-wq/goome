export type AccountRole = 'passenger' | 'driver' | 'admin';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export interface DriverAvailability {
  id: string;
  approved: boolean;
  online: boolean;
  activeRideId: string | null;
  position: Coordinates;
  locationRecordedAt: number;
  accuracyMeters: number;
}

export interface DispatchPolicy {
  now: number;
  radiusMeters: number;
  maxLocationAgeMs: number;
  maxAccuracyMeters: number;
}

export interface FareRules {
  currency: string;
  baseMinor: number;
  perKilometerMinor: number;
  perMinuteMinor: number;
  minimumMinor: number;
}

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'passenger_cancelled'
  | 'driver_cancelled'
  | 'admin_cancelled';

export interface Ride {
  id: string;
  passengerId: string;
  driverId: string | null;
  status: RideStatus;
  version: number;
}

export type RideAction = 'accept' | 'arrive' | 'start' | 'complete' | 'cancel';

export interface Actor {
  id: string;
  role: AccountRole;
}

export class RideRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RideRuleError';
  }
}

export function assertCoordinates(point: Coordinates): void {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 90 ||
    Math.abs(point.longitude) > 180
  ) {
    throw new RideRuleError('A valid latitude and longitude are required.');
  }
}

export function distanceMeters(from: Coordinates, to: Coordinates): number {
  assertCoordinates(from);
  assertCoordinates(to);
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(to.latitude - from.latitude);
  const deltaLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(from.latitude)) *
      Math.cos(radians(to.latitude)) *
      Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

function assertNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RideRuleError(`${label} must be a finite, nonnegative number.`);
  }
}

// This ranks candidates by straight-line distance; a routing service must provide
// road distance and travel time before presenting pickup ETAs to passengers.
export function rankAvailableDrivers(
  pickup: Coordinates,
  drivers: readonly DriverAvailability[],
  policy: DispatchPolicy,
): Array<{ driverId: string; distanceMeters: number }> {
  assertCoordinates(pickup);
  for (const [label, value] of Object.entries(policy)) {
    assertNonNegative(value, label);
  }
  return drivers
    .filter((driver) => {
      const age = policy.now - driver.locationRecordedAt;
      return (
        driver.approved &&
        driver.online &&
        driver.activeRideId === null &&
        Number.isFinite(age) &&
        age >= 0 &&
        age <= policy.maxLocationAgeMs &&
        Number.isFinite(driver.accuracyMeters) &&
        driver.accuracyMeters >= 0 &&
        driver.accuracyMeters <= policy.maxAccuracyMeters
      );
    })
    .flatMap((driver) => {
      try {
        return [{ driverId: driver.id, distanceMeters: distanceMeters(pickup, driver.position) }];
      } catch (error) {
        if (error instanceof RideRuleError) return [];
        throw error;
      }
    })
    .filter((candidate) => candidate.distanceMeters <= policy.radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.driverId.localeCompare(b.driverId));
}

// All money is in the currency's smallest unit. Rules are supplied by the
// operator; this deliberately has no default city, prices, or currency.
export function estimateFare(
  roadDistanceMeters: number,
  travelDurationSeconds: number,
  rules: FareRules,
): { amountMinor: number; currency: string } {
  assertNonNegative(roadDistanceMeters, 'Road distance');
  assertNonNegative(travelDurationSeconds, 'Travel duration');
  if (!/^[A-Z]{3}$/.test(rules.currency)) {
    throw new RideRuleError('A three-letter uppercase currency code is required.');
  }
  for (const amount of [rules.baseMinor, rules.perKilometerMinor, rules.perMinuteMinor, rules.minimumMinor]) {
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new RideRuleError('Fare rules must use nonnegative integer minor units.');
    }
  }
  const amountMinor = Math.max(
    rules.minimumMinor,
    Math.round(
      rules.baseMinor +
        (roadDistanceMeters / 1_000) * rules.perKilometerMinor +
        (travelDurationSeconds / 60) * rules.perMinuteMinor,
    ),
  );
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RideRuleError('The calculated fare exceeds the supported amount.');
  }
  return { amountMinor, currency: rules.currency };
}

const finalStatuses: ReadonlySet<RideStatus> = new Set([
  'completed', 'passenger_cancelled', 'driver_cancelled', 'admin_cancelled',
]);

// The API must load the actor role from trusted account data. Driver approval,
// availability, and this version check must be enforced inside one database
// transaction; a client-side call to this function does not authorize a write.
export function transitionRide(
  ride: Readonly<Ride>,
  actor: Readonly<Actor>,
  action: RideAction,
  expectedVersion: number,
): Ride {
  if (!Number.isSafeInteger(ride.version) || ride.version < 0 || ride.version !== expectedVersion) {
    throw new RideRuleError('This ride has changed. Refresh it before trying again.');
  }
  if (finalStatuses.has(ride.status)) {
    throw new RideRuleError('This ride is already finished.');
  }
  const isPassenger = actor.role === 'passenger' && actor.id === ride.passengerId;
  const isAssignedDriver = actor.role === 'driver' && actor.id === ride.driverId;
  let status: RideStatus;
  let driverId = ride.driverId;

  if (action === 'accept') {
    if (actor.role !== 'driver' || actor.id === ride.passengerId || ride.status !== 'requested' || ride.driverId !== null) {
      throw new RideRuleError('Only an eligible driver can accept an unassigned ride.');
    }
    status = 'accepted';
    driverId = actor.id;
  } else if (action === 'cancel') {
    if (actor.role === 'admin') {
      status = 'admin_cancelled';
    } else if (ride.status === 'in_progress') {
      throw new RideRuleError('Contact support to end a trip already in progress.');
    } else if (isPassenger) {
      status = 'passenger_cancelled';
    } else if (isAssignedDriver) {
      status = 'driver_cancelled';
    } else {
      throw new RideRuleError('You cannot cancel another account’s ride.');
    }
  } else {
    if (!isAssignedDriver) {
      throw new RideRuleError('Only the assigned driver can update this trip.');
    }
    const next = {
      arrive: { from: 'accepted', to: 'arrived' },
      start: { from: 'arrived', to: 'in_progress' },
      complete: { from: 'in_progress', to: 'completed' },
    } as const;
    const step = next[action];
    if (!step || ride.status !== step.from) {
      throw new RideRuleError('The trip cannot move to that step yet.');
    }
    status = step.to;
  }
  return { ...ride, status, driverId, version: ride.version + 1 };
}
