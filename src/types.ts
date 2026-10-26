export interface HabitRecord {
  id: string; // unique key e.g. date + habitName
  name: string; // extracted habit name (e.g. Meditation, Exercise)
  date: number; // journalDay YYYYMMDD
  completed: boolean;
  marker?: string; // TODO, DONE
  content: string; // raw markdown block
  details?: string; // hover details, child notes
  fileSha?: string; // GitHub blob sha
  filePath?: string; // e.g. journals/2026_10_25.md
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
  folder: string;
}
