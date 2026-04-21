const NAMED_GROUP_COLORS: Record<string, string> = {
  Cocina: "var(--group-kitchen)",
  Kitchen: "var(--group-kitchen)",
  Servicio: "var(--group-servers)",
  Asesores: "var(--group-servers)",
  Servers: "var(--group-servers)",
  Bar: "var(--group-bar)",
  Admin: "var(--group-admin)",
};

const FALLBACK_PALETTE = [
  "var(--group-kitchen)",
  "var(--group-servers)",
  "var(--group-bar)",
  "var(--group-admin)",
  "var(--danger)",
  "var(--warning)",
  "var(--success)",
  "var(--info)",
  "var(--nocturno)",
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function groupColor(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  if (NAMED_GROUP_COLORS[name]) return NAMED_GROUP_COLORS[name];
  return FALLBACK_PALETTE[hashString(name) % FALLBACK_PALETTE.length];
}

export const GROUP_COLORS: Record<string, string> = new Proxy(
  {} as Record<string, string>,
  {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") return undefined;
      return groupColor(prop);
    },
  },
);
