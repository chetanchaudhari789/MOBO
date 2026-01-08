export type MigrationContext = {
  // Intentionally structural (avoids a direct dependency on the `mongodb` package types)
  db: any;
  now: Date;
  log: (message: string) => void;
};

export type Migration = {
  id: string;
  description: string;
  up: (ctx: MigrationContext) => Promise<void>;
};
