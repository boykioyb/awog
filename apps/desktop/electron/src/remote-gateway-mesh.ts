import { networkInterfaces } from 'node:os'

// Mesh-network detection for the Remote Gateway (F5, ADR 0067 §2 / spec §Bind;
// transport switched Tailscale → NetBird — see ADR 0067 đính chính 2026-09-27).
//
// The gateway must bind ONLY to the machine's private mesh interface — never
// 0.0.0.0/LAN/public (invariant #6). CIDR alone is not enough: 100.64.0.0/10 is
// shared CGNAT space (4G tethering, carrier NAT) so we require BOTH the CGNAT
// range AND a mesh-looking interface name. Fail-closed: no match → no bind.
//
// NetBird assigns peers 100.64.0.0/10 addresses on a `wt0`/`utun` interface;
// Tailscale does the same on `tailscale*`/`utun`, so one heuristic covers both
// (a self-hosted NetBird on a custom range is intentionally NOT detected — the
// CGNAT check is the fail-closed invariant).
//
// This is a heuristic (a robust identity check would query the client's local
// API — `netbird status` / `tailscale ip`); the per-connection remoteAddress
// check below is the second line so a mis-detected interface still can't serve
// a non-mesh peer.

const MESH_IFACE_RE = /^(utun|tailscale|ts|wt|nb|netbird)/i

// True if `ip` (IPv4, or IPv6-mapped IPv4) is in the CGNAT range 100.64.0.0/10,
// i.e. 100.64.0.0 – 100.127.255.255 — the default address pool of both NetBird
// and Tailscale meshes.
export function isMeshAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const parts = v4.split('.')
  if (parts.length !== 4) return false
  const a = Number(parts[0])
  const b = Number(parts[1])
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false
  return a === 100 && b >= 64 && b <= 127
}

// The machine's mesh IPv4 address, or null if no mesh VPN is up. Requires the
// address to be in CGNAT range AND on an interface whose name looks like a mesh
// client (NetBird `wt0`/`utun`, Tailscale `tailscale*`/`utun`, …).
export function findMeshAddress(): string | null {
  const ifaces = networkInterfaces()
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs || !MESH_IFACE_RE.test(name)) continue
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal && isMeshAddress(addr.address)) {
        return addr.address
      }
    }
  }
  return null
}
