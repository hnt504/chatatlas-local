// A small command-line reader: positional words, --name value, --name=value and --flag.

/**
 * @param {string[]} argv
 * @param {{ flags?: string[], short?: Record<string, string> }} spec  flags = options that take no value
 * @returns {{ _: string[], [k: string]: any }}
 */
export function parseArgs(argv, { flags = [], short = {} } = {}) {
  const out = { _: [] };
  const isFlag = new Set(flags);
  for (let i = 0; i < argv.length; i += 1) {
    let a = argv[i];
    if (a === '--') {
      out._.push(...argv.slice(i + 1));
      break;
    }
    if (/^-[a-zA-Z]$/.test(a) && short[a.slice(1)]) a = `--${short[a.slice(1)]}`;
    if (!a.startsWith('--') || a === '--') {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const name = (eq === -1 ? a.slice(2) : a.slice(2, eq)).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (eq !== -1) {
      out[name] = a.slice(eq + 1);
    } else if (name.startsWith('no') && name.length > 2 && isFlag.has(name[2].toLowerCase() + name.slice(3))) {
      out[name[2].toLowerCase() + name.slice(3)] = false;
    } else if (isFlag.has(name)) {
      out[name] = true;
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[name] = argv[(i += 1)];
    } else {
      out[name] = true;
    }
  }
  return out;
}
