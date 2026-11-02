export interface DevRef {
  type: 'task' | 'check' | 'doc' | 'note';
  task?: number;
  num?: number;
  doc?: number;
  section?: string;
  note?: number;
}
export interface DevRefFound extends DevRef {
  ref: string;
  start: number;
  end: number;
}
export interface DocHeading {
  text: string;
  level: number;
  line: number;
}
export function parseRefs(text: string | null | undefined): DevRefFound[];
export function parseRef(s: string | null | undefined): DevRef | null;
export function formatRef(r: DevRef): string;
export function docHeadings(content: string | null | undefined): DocHeading[];
export function matchSection(
  headings: DocHeading[],
  section: string,
): { heading: DocHeading; ambiguous?: undefined } | { ambiguous: DocHeading[]; heading?: undefined } | null;
export function sectionText(content: string | null | undefined, headings: DocHeading[], heading: DocHeading): string;
