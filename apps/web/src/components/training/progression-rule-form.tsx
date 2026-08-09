import { useState } from "react";

import { LoaderCircle } from "lucide-react";

import {
    createProgressionRuleRequestSchema,
    updateProgressionRuleRequestSchema,
    type RuleScopeTypeValue,
    type RuleTargetModeValue,
} from "@kinetix/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MultiSelectField } from "@/components/ui/multi-select-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { progressionRuleRequest, type ProgressionRuleFormValues } from "@/lib/progression-rule-form";

const SCOPE_TYPES: RuleScopeTypeValue[] = ["program", "block", "template", "exercise", "set"];
const TARGET_MODES: RuleTargetModeValue[] = ["next", "block_future", "template"];
const SELECTOR_KINDS = ["scope", "exercise", "set", "run_step"] as const;
const TRIGGER_OPTIONS = [
    { value: "session_completed", label: "Session completed" },
    { value: "scheduled", label: "Scheduled" },
    { value: "manual", label: "Manual" },
];

interface FormProps {
    readonly defaultValues: ProgressionRuleFormValues;
    readonly mode: "create" | "edit";
    readonly isSubmitting: boolean;
    readonly submitError: Error | null;
    readonly onSubmit: (values: ProgressionRuleFormValues) => Promise<void>;
    readonly submitLabel: string;
}

export function ProgressionRuleForm({
    defaultValues,
    mode,
    isSubmitting,
    submitError,
    onSubmit,
    submitLabel,
}: FormProps): React.JSX.Element {
    const [values, setValues] = useState<ProgressionRuleFormValues>(defaultValues);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

    const set = <K extends keyof ProgressionRuleFormValues>(key: K, value: ProgressionRuleFormValues[K]): void =>
        setValues(previous => ({ ...previous, [key]: value }));

    const handleSubmit = async (event: React.FormEvent): Promise<void> => {
        event.preventDefault();
        const errors: Record<string, string[]> = {};
        let payload: Record<string, unknown> | null = null;
        try {
            payload = progressionRuleRequest(values);
        } catch {
            errors["condition/actions"] = ["Condition and actions must be valid JSON"];
        }
        if (payload) {
            const schema = mode === "create" ? createProgressionRuleRequestSchema : updateProgressionRuleRequestSchema;
            const parsed = schema.safeParse(payload);
            if (!parsed.success)
                for (const issue of parsed.error.issues) {
                    const path = issue.path.length > 0 ? issue.path.map(String).join(".") : "$";
                    (errors[path] ??= []).push(issue.message);
                }
        }
        setFieldErrors(errors);
        if (Object.keys(errors).length > 0) return;
        await onSubmit(values);
    };

    return (
        <form className="space-y-4" onSubmit={handleSubmit}>
            <Field label="Name" error={fieldErrors.name}>
                <Input
                    onChange={event => set("name", event.target.value)}
                    placeholder="e.g. Progress bench"
                    value={values.name}
                />
            </Field>
            <Field label="Description" error={fieldErrors.description}>
                <Textarea
                    onChange={event => set("description", event.target.value)}
                    rows={2}
                    value={values.description}
                />
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Scope" error={fieldErrors.scope}>
                    <Select
                        onValueChange={value => set("scopeType", value as RuleScopeTypeValue)}
                        value={values.scopeType}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SCOPE_TYPES.map(type => (
                                <SelectItem key={type} value={type}>
                                    {type}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Scope ID (UUID)" error={fieldErrors["scope.id"]}>
                    <Input onChange={event => set("scopeId", event.target.value)} value={values.scopeId} />
                </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Target mode" error={fieldErrors["target.mode"]}>
                    <Select
                        onValueChange={value => set("targetMode", value as RuleTargetModeValue)}
                        value={values.targetMode}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {TARGET_MODES.map(target => (
                                <SelectItem key={target} value={target}>
                                    {target}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Target selector" error={fieldErrors.target}>
                    <Select
                        onValueChange={value => set("selectorKind", value as ProgressionRuleFormValues["selectorKind"])}
                        value={values.selectorKind}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {SELECTOR_KINDS.map(kind => (
                                <SelectItem key={kind} value={kind}>
                                    {kind}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Field>
            </div>
            {values.selectorKind !== "scope" ? (
                <Field label="Selector logical key (UUID)" error={fieldErrors["target.selector.logicalKey"]}>
                    <Input
                        onChange={event => set("selectorLogicalKey", event.target.value)}
                        value={values.selectorLogicalKey}
                    />
                </Field>
            ) : null}

            <Field label="Triggers" error={fieldErrors.triggers}>
                <MultiSelectField
                    onValueChange={value => set("triggers", value)}
                    options={TRIGGER_OPTIONS}
                    value={values.triggers}
                />
            </Field>

            <div className="grid grid-cols-2 gap-3">
                <Field label="Enabled" error={fieldErrors.enabled}>
                    <Select onValueChange={value => set("enabled", value === "true")} value={String(values.enabled)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="true">Enabled</SelectItem>
                            <SelectItem value="false">Disabled</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
                <Field label="Auto-apply" error={fieldErrors.autoApply}>
                    <Select
                        onValueChange={value => set("autoApply", value === "true")}
                        value={String(values.autoApply)}
                    >
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="false">Requires approval</SelectItem>
                            <SelectItem value="true">Auto-apply</SelectItem>
                        </SelectContent>
                    </Select>
                </Field>
            </div>

            <Field label="Safety policy key (optional)" error={fieldErrors.safetyPolicy}>
                <Input onChange={event => set("safetyPolicyKey", event.target.value)} value={values.safetyPolicyKey} />
            </Field>

            <Field label="Condition (JSON AST)" error={fieldErrors.condition ?? fieldErrors["condition/actions"]}>
                <Textarea
                    className="font-mono text-xs"
                    onChange={event => set("conditionJson", event.target.value)}
                    rows={8}
                    value={values.conditionJson}
                />
            </Field>
            <Field label="Actions (JSON array)" error={fieldErrors.actions}>
                <Textarea
                    className="font-mono text-xs"
                    onChange={event => set("actionsJson", event.target.value)}
                    rows={6}
                    value={values.actionsJson}
                />
            </Field>

            {submitError ? (
                <div
                    className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border p-3 text-sm"
                    role="alert"
                >
                    {submitError.message}
                </div>
            ) : null}

            <Button className="w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
                {submitLabel}
            </Button>
        </form>
    );
}

function Field({
    label,
    error,
    children,
}: {
    readonly label: string;
    readonly error?: string[];
    readonly children: React.ReactNode;
}): React.JSX.Element {
    return (
        <div className="space-y-1.5">
            <Label>{label}</Label>
            {children}
            {error ? <p className="text-destructive text-sm">{error.join(", ")}</p> : null}
        </div>
    );
}
