import { Controller, Get, Inject, Param } from "@nestjs/common";
import { ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";

import { jobIdSchema, jobResourceSchema, type JobResource } from "@kinetix/types";

import {
    ApplicationNotFoundError,
    ApplicationValidationError,
    JOB_STATUS_READER,
    type JobProgress,
    type JobStatus,
    type JobStatusReader,
} from "#src/platform/application/index";

@ApiTags("jobs")
@Controller({ path: "jobs", version: "1" })
export class JobController {
    constructor(
        @Inject(JOB_STATUS_READER)
        private readonly jobs: JobStatusReader,
    ) {}

    @Get(":id")
    @ApiOperation({ summary: "Get safe durable-job status and progress" })
    @ApiParam({ name: "id", format: "uuid" })
    async status(@Param("id") id: string): Promise<JobResource> {
        const parsedId = jobIdSchema.safeParse(id);
        if (!parsedId.success)
            throw new ApplicationValidationError("Job ID must be a UUID", { id: ["Job ID must be a UUID"] });
        const job = await this.jobs.find(parsedId.data);
        if (!job) throw new ApplicationNotFoundError(`Job ${parsedId.data} was not found`, { jobId: parsedId.data });
        return jobResourceSchema.parse(toResource(job));
    }
}

function toResource(job: JobStatus): JobResource {
    return {
        id: job.id,
        type: job.type,
        version: job.version,
        state: job.state,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        progress: job.progress ? progressResource(job.progress) : null,
        error: job.error
            ? {
                  code: job.error.code,
                  message: job.error.message,
                  retryable: job.error.retryable,
                  failedAt: job.error.failedAt.toISOString(),
              }
            : null,
        correlationId: job.correlationId,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        nextAttemptAt: job.nextAttemptAt.toISOString(),
        completedAt: job.completedAt?.toISOString() ?? null,
        updatedAt: job.updatedAt.toISOString(),
    };
}

function progressResource(progress: JobProgress): NonNullable<JobResource["progress"]> {
    const percentage =
        progress.total === undefined
            ? undefined
            : Math.min(100, Math.round((progress.completed / progress.total) * 100));
    return {
        completed: progress.completed,
        ...(progress.total === undefined ? {} : { total: progress.total }),
        ...(percentage === undefined ? {} : { percentage }),
        ...(progress.message === undefined ? {} : { message: progress.message }),
    };
}
