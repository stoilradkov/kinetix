export interface KinetixModuleDefinition {
    readonly type: string;
    readonly version: number;
    readonly displayName: string;
    readonly cardinality: "one" | "many";
}
