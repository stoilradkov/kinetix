import { describe, expect, it } from "vitest";

import { healthDataModuleDefinition, HealthDataModule } from "#src/modules/health-data/index";
import { profileModuleDefinition, ProfileModule } from "#src/modules/profile/index";
import { trainingModuleDefinition, TrainingModule } from "#src/modules/training/index";

describe("bounded module skeletons", () => {
    it("publish stable application definitions", () => {
        expect([profileModuleDefinition.type, healthDataModuleDefinition.type, trainingModuleDefinition.type]).toEqual([
            "profile",
            "health-data",
            "training",
        ]);
    });

    it.each([ProfileModule, HealthDataModule, TrainingModule])(
        "registers %s through Nest dependency injection",
        moduleType => {
            expect(Reflect.getMetadata("providers", moduleType).length).toBeGreaterThanOrEqual(1);
        },
    );
});
