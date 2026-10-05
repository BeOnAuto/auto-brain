type ConsoleMethod = 'warn' | 'debug';

type Write = (...data: readonly unknown[]) => void;

interface Routing {
  readonly originals: Readonly<Record<ConsoleMethod, Write>>;
  readonly reports: Set<(message: string) => void>;
}

const methods: readonly ConsoleMethod[] = ['warn', 'debug'];

const clientLines = /^(?:\[mcp-sdk\]|Client\.)/u;

let routing: Routing | undefined;

function routed(original: Write, reports: ReadonlySet<(message: string) => void>): Write {
  return (...data) => {
    const [first] = data;
    if (typeof first === 'string' && clientLines.test(first)) {
      const message = data.map(String).join(' ');
      for (const report of reports) {
        report(message);
      }
      return;
    }
    original(...data);
  };
}

function installed(): Routing {
  const originals = { warn: console.warn.bind(console), debug: console.debug.bind(console) };
  const reports = new Set<(message: string) => void>();
  for (const method of methods) {
    console[method] = routed(originals[method], reports);
  }
  return { originals, reports };
}

export function routeClientConsole(report: (message: string) => void): () => void {
  routing ??= installed();
  const { reports } = routing;
  const own = (message: string): void => {
    report(message);
  };
  reports.add(own);
  return () => {
    reports.delete(own);
    if (reports.size === 0 && routing !== undefined) {
      console.warn = routing.originals.warn;
      console.debug = routing.originals.debug;
      routing = undefined;
    }
  };
}
