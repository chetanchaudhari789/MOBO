declare module 'seedrandom' {
  type SeedRandom = {
    (seed?: string, options?: { global?: boolean }): () => number;
  };

  const seedrandom: SeedRandom;
  export default seedrandom;
}
