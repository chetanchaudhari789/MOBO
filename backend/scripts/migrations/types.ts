export type MigrationContext = {
  // Intentionally structural (avoids tight coupling to PostgreSQL driver types)
  db: any;
  now: Date;
  log: (message: string) => void;
};

export type Migration = {
  id: string;
  description: string;
  up: (ctx: MigrationContext) => Promise<void>;
};
