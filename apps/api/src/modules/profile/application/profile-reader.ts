import { ApplicationNotFoundError } from "#src/platform/application/index";

import type { CoreProfileResource } from "#src/modules/profile/application/core-profile";
import type { ProfileSex, UnitPreferences } from "#src/modules/profile/domain/index";

export const PROFILE_READER = Symbol("PROFILE_READER");

/** Stable projection of the active core profile that other modules may read. */
export interface CoreProfileSummary {
    readonly id: string;
    readonly timeZone: string;
    readonly unitPreferences: UnitPreferences;
    readonly birthDate: string | null;
    readonly sex: ProfileSex | null;
    readonly heightMeters: string | null;
    readonly version: number;
}

/**
 * Public port that lets other modules obtain the active core profile's ID and
 * defaults without reading Profile-owned tables. See ADR 0005.
 */
export interface ProfileReader {
    getActiveProfile(): Promise<CoreProfileSummary>;
    findActiveProfile(): Promise<CoreProfileSummary | null>;
    requireActiveProfileId(): Promise<string>;
}

export class ActiveCoreProfileNotFoundError extends ApplicationNotFoundError {
    constructor() {
        super("No active core profile exists");
        this.name = "ActiveCoreProfileNotFoundError";
    }
}

export function coreProfileSummary(resource: CoreProfileResource): CoreProfileSummary {
    return {
        id: resource.id,
        timeZone: resource.timeZone,
        unitPreferences: resource.unitPreferences,
        birthDate: resource.birthDate,
        sex: resource.sex,
        heightMeters: resource.heightMeters,
        version: resource.version,
    };
}

export class CoreProfileReader implements ProfileReader {
    constructor(private readonly source: { readActive(): Promise<CoreProfileResource | null> }) {}

    async findActiveProfile(): Promise<CoreProfileSummary | null> {
        const resource = await this.source.readActive();
        return resource ? coreProfileSummary(resource) : null;
    }

    async getActiveProfile(): Promise<CoreProfileSummary> {
        const summary = await this.findActiveProfile();
        if (!summary) throw new ActiveCoreProfileNotFoundError();
        return summary;
    }

    async requireActiveProfileId(): Promise<string> {
        return (await this.getActiveProfile()).id;
    }
}
