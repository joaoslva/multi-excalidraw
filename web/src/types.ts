/** An empty group means Ungrouped. */
export interface Ref {
  group: string;
  name: string;
}

export interface BoardEntry {
  name: string;
  rev: string;
}

export interface GroupEntry {
  name: string;
  boards: BoardEntry[];
}

export interface Tree {
  groups: GroupEntry[];
  ungrouped: BoardEntry[];
  last: Ref | null;
}
