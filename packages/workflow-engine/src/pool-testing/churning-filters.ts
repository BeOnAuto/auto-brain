export const evaluatedAt = Date.parse('2026-10-01T09:00:00.000Z');

export const churn =
  '(() => { const big = "x".repeat(4194304); let total = 0; for (let round = 0; round < 1000000; round += 1) { total += JSON.stringify([big, round]).length; } return total > 0; })()';

export const closed = { type: 'com.acme.closed', data: { region: 'eu' } };

export const churningFilter = { reference: '/churn', attributes: { type: 'com.acme.closed', data: `\${ ${churn} }` } };

export const plainFilter = {
  reference: '/plain',
  attributes: { type: 'com.acme.closed', data: '${ $data.region == "eu" }' },
};
