import type { ProgressionRuleResponse, RuleScopeTypeValue, RuleTargetModeValue } from "@kinetix/types";

export interface ProgressionRuleFormValues {
    name: string;
    description: string;
    scopeType: RuleScopeTypeValue;
    scopeId: string;
    targetMode: RuleTargetModeValue;
    selectorKind: "scope" | "exercise" | "set" | "run_step";
    selectorLogicalKey: string;
    triggers: string[];
    enabled: boolean;
    autoApply: boolean;
    safetyPolicyKey: string;
    conditionJson: string;
    actionsJson: string;
}

export function progressionRuleFormDefaults(): ProgressionRuleFormValues {
    return {
        name: "",
        description: "",
        scopeType: "template",
        scopeId: "",
        targetMode: "next",
        selectorKind: "scope",
        selectorLogicalKey: "",
        triggers: ["session_completed"],
        enabled: true,
        autoApply: false,
        safetyPolicyKey: "",
        conditionJson: JSON.stringify(
            { kind: "metric", metric: { key: "completed_all_sets", scope: "exercise" }, operator: "eq", value: true },
            null,
            2,
        ),
        actionsJson: JSON.stringify([{ type: "adjust_load", mode: "percent", value: 2.5 }], null, 2),
    };
}

export function progressionRuleFormValues(rule: ProgressionRuleResponse): ProgressionRuleFormValues {
    return {
        name: rule.name,
        description: rule.description ?? "",
        scopeType: rule.scope.type,
        scopeId: rule.scope.id,
        targetMode: rule.target.mode,
        selectorKind: rule.target.selector.kind,
        selectorLogicalKey: rule.target.selector.kind === "scope" ? "" : rule.target.selector.logicalKey,
        triggers: [...rule.triggers],
        enabled: rule.enabled,
        autoApply: rule.autoApply,
        safetyPolicyKey: rule.safetyPolicy.policyKey ?? "",
        conditionJson: JSON.stringify(rule.condition, null, 2),
        actionsJson: JSON.stringify(rule.actions, null, 2),
    };
}

/** Builds the wire request from form values; throws on malformed JSON in the AST/actions fields. */
export function progressionRuleRequest(values: ProgressionRuleFormValues): Record<string, unknown> {
    const selector =
        values.selectorKind === "scope"
            ? { kind: "scope" as const }
            : { kind: values.selectorKind, logicalKey: values.selectorLogicalKey.trim() };
    return {
        name: values.name.trim(),
        description: values.description.trim() === "" ? null : values.description.trim(),
        scope: { type: values.scopeType, id: values.scopeId.trim() },
        target: { mode: values.targetMode, selector },
        condition: JSON.parse(values.conditionJson),
        actions: JSON.parse(values.actionsJson),
        triggers: values.triggers,
        enabled: values.enabled,
        autoApply: values.autoApply,
        safetyPolicy: {
            policyKey: values.safetyPolicyKey.trim() === "" ? null : values.safetyPolicyKey.trim(),
            config: {},
        },
    };
}
