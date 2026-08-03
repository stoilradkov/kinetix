import { useEffect, useRef, useState } from "react";

import { Pause, Play, RotateCcw, Timer } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Server-timestamp-anchored elapsed timer: recomputes from `startedAt` each second, survives reload. */
export function ElapsedTimer({ startedAt }: { readonly startedAt: string }): React.JSX.Element {
    const [elapsedMs, setElapsedMs] = useState(() => Date.now() - Date.parse(startedAt));
    useEffect(() => {
        const tick = () => setElapsedMs(Date.now() - Date.parse(startedAt));
        tick();
        const handle = setInterval(tick, 1_000);
        return () => clearInterval(handle);
    }, [startedAt]);
    return (
        <Badge variant="info">
            <Timer className="size-3" />
            <span className="font-mono tabular-nums">{formatElapsed(elapsedMs)}</span>
        </Badge>
    );
}

export function formatElapsed(milliseconds: number): string {
    const total = Math.max(0, Math.floor(milliseconds / 1_000));
    const hours = Math.floor(total / 3_600);
    const minutes = Math.floor((total % 3_600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map(part => String(part).padStart(2, "0")).join(":");
}

const REST_PRESETS_SECONDS = [60, 90, 120, 180] as const;

/**
 * Client-side rest countdown between sets (the server stores timestamps; the countdown is a client
 * responsibility per PRD UX-3). Start/pause/reset with quick presets; turns to a warning at zero.
 */
export function RestTimer(): React.JSX.Element {
    const [remainingMs, setRemainingMs] = useState(0);
    const [running, setRunning] = useState(false);
    const deadlineRef = useRef<number | null>(null);

    useEffect(() => {
        if (!running) return;
        const tick = () => {
            const remaining = Math.max(0, (deadlineRef.current ?? 0) - Date.now());
            setRemainingMs(remaining);
            if (remaining <= 0) setRunning(false);
        };
        tick();
        const handle = setInterval(tick, 250);
        return () => clearInterval(handle);
    }, [running]);

    const startFor = (seconds: number) => {
        deadlineRef.current = Date.now() + seconds * 1_000;
        setRemainingMs(seconds * 1_000);
        setRunning(true);
    };
    const done = !running && remainingMs <= 0;

    return (
        <div className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-3">
            <Badge variant={done ? "secondary" : remainingMs <= 5_000 && running ? "warning" : "info"}>
                <Timer className="size-3" />
                <span className="font-mono tabular-nums">{formatElapsed(remainingMs)}</span>
            </Badge>
            {REST_PRESETS_SECONDS.map(seconds => (
                <Button key={seconds} onClick={() => startFor(seconds)} size="sm" variant="outline">
                    {seconds < 60 ? `${seconds}s` : `${seconds / 60}m`}
                </Button>
            ))}
            <Button
                aria-label={running ? "Pause rest timer" : "Resume rest timer"}
                disabled={remainingMs <= 0}
                onClick={() => setRunning(value => !value)}
                size="icon"
                variant="ghost"
            >
                {running ? <Pause /> : <Play />}
            </Button>
            <Button
                aria-label="Reset rest timer"
                onClick={() => {
                    setRunning(false);
                    setRemainingMs(0);
                    deadlineRef.current = null;
                }}
                size="icon"
                variant="ghost"
            >
                <RotateCcw />
            </Button>
        </div>
    );
}
