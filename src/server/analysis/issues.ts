/** A deterministic change applied to model output, kept for transparency. */
export interface Repair {
  kind: string
  detail: string
}

/** A problem only a (narrow) model repair can fix. */
export interface StructuralIssue {
  path: string
  message: string
}

export type Finalised<T> =
  | { status: 'valid'; value: T; repairs: Repair[] }
  | { status: 'needs-model-repair'; issues: StructuralIssue[]; repairs: Repair[] }
