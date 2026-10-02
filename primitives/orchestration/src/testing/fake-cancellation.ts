export class FakeCancellation extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'FakeCancellation';
  }
}
