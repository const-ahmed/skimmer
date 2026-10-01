export interface Repair {
  kind: string
  detail: string
}

export interface StructuralIssue {
  path: string
  message: string
}

export type Finalised<T> =
  | { status: 'valid'; value: T; repairs: Repair[] }
  | { status: 'needs-model-repair'; issues: StructuralIssue[]; repairs: Repair[] }
