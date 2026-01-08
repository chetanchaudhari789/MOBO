export function rupeesToPaise(rupees: number): number {
  if (!Number.isFinite(rupees)) return 0;
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  if (!Number.isFinite(paise)) return 0;
  return Math.round(paise) / 100;
}
