import { Controller, Get } from "@nestjs/common";
import { ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";

import type { HealthResponse } from "@kinetix/types";

import { HealthService } from "#src/health/health.service.js";

@ApiTags("health")
@Controller({ path: "health", version: "1" })
export class HealthController {
    constructor(private readonly healthService: HealthService) {}

    @Get()
    @ApiOperation({ summary: "Liveness probe" })
    @ApiOkResponse({ description: "The service process is healthy" })
    getHealth(): HealthResponse {
        return this.healthService.getHealth();
    }

    @Get("ready")
    @ApiOperation({ summary: "Readiness probe" })
    @ApiOkResponse({ description: "The service and database are ready" })
    async getReadiness(): Promise<HealthResponse> {
        return this.healthService.getReadiness();
    }
}
