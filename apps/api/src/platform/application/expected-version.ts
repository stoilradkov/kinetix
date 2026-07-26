import { AggregateVersion } from "#src/platform/domain/index";

import {
    ApplicationValidationError,
    ExpectedVersionRequiredError,
    VersionConflictError,
} from "#src/platform/application/errors";

export class ExpectedVersionGuard {
    verify(expectedVersion: number | undefined, currentVersion: number): void {
        if (expectedVersion === undefined) throw new ExpectedVersionRequiredError();
        const current = AggregateVersion.from(currentVersion);
        let expected: AggregateVersion;
        try {
            expected = AggregateVersion.from(expectedVersion);
        } catch {
            throw new ApplicationValidationError("Expected aggregate version must be a positive integer");
        }
        if (!expected.equals(current)) throw new VersionConflictError(expected.value, current.value);
    }
}

export function assertExpectedVersion(expectedVersion: number | undefined, currentVersion: number): void {
    new ExpectedVersionGuard().verify(expectedVersion, currentVersion);
}
