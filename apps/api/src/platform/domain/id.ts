declare const entityIdBrand: unique symbol;

export type EntityId = string & { readonly [entityIdBrand]: true };

export function entityId(value: string): EntityId {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
        throw new Error("Entity ID must be a UUID");
    }

    return value as EntityId;
}
