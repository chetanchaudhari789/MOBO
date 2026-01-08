import type { Migration } from './types.js';

import { m20260108_indexes_softdelete_unique } from './m20260108_indexes_softdelete_unique.js';

export const migrations: Migration[] = [m20260108_indexes_softdelete_unique];
