import { Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { HealthRecordTypeValue, ManualHealthRecordResponse } from "@kinetix/types";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

interface Point {
    readonly t: number;
    readonly label: string;
    readonly value: number;
}

interface Spec {
    readonly kind: "line" | "bar";
    readonly color: string;
    readonly label: string;
    readonly emptyNoun: string;
    readonly yDomain: (values: readonly number[]) => [number, number];
}

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** Padded, non-zero-based domain — small movements would vanish against a 0 baseline. */
function padded(values: readonly number[]): [number, number] {
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.5, (max - min) * 0.15);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
}

const SPECS: Record<HealthRecordTypeValue, Spec> = {
    body_weight: {
        kind: "line",
        color: "var(--chart-1)",
        label: "Weight (kg)",
        emptyNoun: "weigh-ins",
        yDomain: padded,
    },
    sleep: {
        kind: "bar",
        color: "var(--chart-2)",
        label: "Sleep (h)",
        emptyNoun: "nights",
        yDomain: values => [0, Math.ceil(Math.max(...values))],
    },
    resting_heart_rate: {
        kind: "line",
        color: "var(--chart-3)",
        label: "Resting HR (bpm)",
        emptyNoun: "readings",
        yDomain: padded,
    },
    daily_readiness: {
        kind: "line",
        color: "var(--chart-4)",
        label: "Readiness",
        emptyNoun: "check-ins",
        yDomain: () => [0, 100],
    },
};

function metricValue(record: ManualHealthRecordResponse): number {
    switch (record.body.type) {
        case "body_weight":
            return record.body.massKg;
        case "resting_heart_rate":
            return record.body.beatsPerMinute;
        case "daily_readiness":
            return record.body.score;
        case "sleep": {
            const minutes = (new Date(record.body.endAt).getTime() - new Date(record.body.startAt).getTime()) / 60_000;
            return Math.round((minutes / 60) * 10) / 10;
        }
    }
}

function toSeries(records: readonly ManualHealthRecordResponse[]): Point[] {
    return records
        .map(record => {
            const t = new Date(record.effectiveAt).getTime();
            return { t, label: dayFormatter.format(new Date(t)), value: metricValue(record) };
        })
        .sort((a, b) => a.t - b.t);
}

export function HealthTrendChart({
    type,
    records,
}: {
    readonly type: HealthRecordTypeValue;
    readonly records: readonly ManualHealthRecordResponse[];
}): React.JSX.Element {
    const spec = SPECS[type];
    const series = toSeries(records);

    if (series.length < 2) {
        return (
            <div className="text-muted-foreground grid h-64 place-items-center rounded-lg border border-dashed px-4 text-center text-sm">
                Log at least two {spec.emptyNoun} to see a trend.
            </div>
        );
    }

    const config = { value: { label: spec.label, color: spec.color } } satisfies ChartConfig;
    const yDomain = spec.yDomain(series.map(point => point.value));
    const tooltip = (
        <ChartTooltip
            content={
                <ChartTooltipContent
                    labelFormatter={(_label, payload) => {
                        const point = payload?.[0]?.payload as Point | undefined;
                        return point ? fullFormatter.format(new Date(point.t)) : "";
                    }}
                />
            }
            cursor
        />
    );

    return (
        <ChartContainer className="h-64 w-full" config={config}>
            {spec.kind === "bar" ? (
                <BarChart accessibilityLayer data={series} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                        axisLine={false}
                        dataKey="label"
                        interval="preserveStartEnd"
                        tickLine={false}
                        tickMargin={8}
                    />
                    <YAxis axisLine={false} domain={yDomain} tickLine={false} tickMargin={8} width={36} />
                    {tooltip}
                    <Bar dataKey="value" fill="var(--color-value)" radius={[4, 4, 0, 0]} />
                </BarChart>
            ) : (
                <LineChart accessibilityLayer data={series} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                        axisLine={false}
                        dataKey="t"
                        domain={["dataMin", "dataMax"]}
                        scale="time"
                        tickFormatter={value => dayFormatter.format(new Date(value as number))}
                        tickLine={false}
                        tickMargin={8}
                        type="number"
                    />
                    <YAxis axisLine={false} domain={yDomain} tickLine={false} tickMargin={8} width={36} />
                    {tooltip}
                    <Line
                        activeDot={{ r: 5 }}
                        dataKey="value"
                        dot={{ r: 3 }}
                        stroke="var(--color-value)"
                        strokeWidth={2}
                        type="monotone"
                    />
                </LineChart>
            )}
        </ChartContainer>
    );
}
