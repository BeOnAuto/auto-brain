export async function isAcceptingConnections(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/health`);
    return true;
  } catch {
    return false;
  }
}
