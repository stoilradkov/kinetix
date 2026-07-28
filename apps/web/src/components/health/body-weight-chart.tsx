import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import type { ManualHealthRecordResponse } from "@kinetix/types";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";

const config = {
    weight: { label: "Weight (kg)", color: "var(--chart-1)" },
} satisfies ChartConfig;

interface WeightPoint {
    readonly t: number;
    readonly weight: number;
}

function toSeries(records: readonly ManualHealthRecordResponse[]): WeightPoint[] {
    return records
        .filter(record => record.body.type === "body_weight")
        .map(record => ({
            t: new Date(record.effectiveAt).getTime(),
            weight: record.body.type === "body_weight" ? record.body.massKg : 0,
        }))
        .sort((a, b) => a.t - b.t);
}

/** Padded, non-zero-based domain — weight moves in small ranges, so a 0 baseline hides the trend. */
function domainOf(series: readonly WeightPoint[]): [number, number] {
    const values = series.map(point => point.weight);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = Math.max(0.5, (max - min) * 0.15);
    return [Math.floor(min - pad), Math.ceil(max + pad)];
}

const dayFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });
const fullFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

export function BodyWeightChart({
    records,
}: {
    readonly records: readonly ManualHealthRecordResponse[];
}): React.JSX.Element {
    const series = toSeries(records);

    if (series.length < 2) {
        return (
            <div className="text-muted-foreground grid h-64 place-items-center rounded-lg border border-dashed text-sm">
                Log at least two weigh-ins to see a trend.
            </div>
        );
    }

    return (
        <ChartContainer className="h-64 w-full" config={config}>
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
                <YAxis axisLine={false} domain={domainOf(series)} tickLine={false} tickMargin={8} width={36} />
                <ChartTooltip
                    content={
                        <ChartTooltipContent
                            labelFormatter={value => fullFormatter.format(new Date(value as number))}
                        />
                    }
                    cursor
                />
                <Line
                    activeDot={{ r: 5 }}
                    dataKey="weight"
                    dot={{ r: 3 }}
                    stroke="var(--color-weight)"
                    strokeWidth={2}
                    type="monotone"
                />
            </LineChart>
        </ChartContainer>
    );
}
