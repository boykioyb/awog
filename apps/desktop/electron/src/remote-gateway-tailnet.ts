import { networkInterfaces } from 'node:os'

// Tailnet detection for the Remote Gateway (F5, ADR 0067 §2 / spec §Bind).
//
// The gateway must bind ONLY to the machine's Tailscale interface — never
// 0.0.0.0/LAN/public (invariant #6). CIDR alone is not enough: 100.64.0.0/10 is
// shared CGNAT space (4G tethering, carrier NAT) so we require BOTH the CGNAT
// range AND a Tailscale-looking interface name. Fail-closed: no match → no bind.
//
// This is a heuristic (a robust identity check would query the Tailscale local API
// / `tailscale ip`); the per-connection remoteAddress check below is the second
// line so a mis-detected interface still can't serve a non-tailnet peer.

const TAILNET_IFACE_RE = /^(utun|tailscale|ts|wt)/i

// True if `ip` (IPv4, or IPv6-mapped IPv4) is in the CGNAT range 100.64.0.0/10,
// i.e. 100.64.0.0 – 100.127.255.255.
export function isTailnetAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const parts = v4.split('.')
  if (parts.length !== 4) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false
  return a === 100 && b >= 64 && b <= 127
}

// The machine's tailnet IPv4 address, or null if Tailscale is not up. Requires the
// address to be in CGNAT range AND on an interface whose name looks like Tailscale.
export function findTailnetAddress(): string | null {
  const ifaces = networkInterfaces()
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || !TAILNET_IFACE_RE.test(name)) continue
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && isTailnetAddress(addr.address)) {
        return addr.address
      }
    }
  }
  return null
}
