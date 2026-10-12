/**
 * Recursively readonly view of a value. Schemas are the single source of truth (02 §3);
 * types are inferred from them and wrapped in this so project data is immutable at compile time
 * without freezing objects at runtime.
 */
export type DeepReadonly<T> = T extends (infer U)[]
  ? ReadonlyArray<DeepReadonly<U>>
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;
