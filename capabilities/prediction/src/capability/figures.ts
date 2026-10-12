const figures = new Intl.NumberFormat('en', { maximumFractionDigits: 20 });

export function figure(count: number): string {
  return figures.format(count);
}
