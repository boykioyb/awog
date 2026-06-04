# Sidecar binary location

Tauri's `externalBin` feature expects native sidecar binaries here, named:

```
awog-sidecar-<target-triple>
```

Where `<target-triple>` matches the host platform, e.g.:

- `aarch64-apple-darwin`
- `x86_64-apple-darwin`
- `x86_64-pc-windows-msvc`
- `x86_64-unknown-linux-gnu`

## How to populate

Build the sidecar:

```bash
pnpm --filter @awog/sidecar build
```

The sidecar build script (`apps/desktop/sidecar/scripts/build.mjs`) emits to:

```
apps/desktop/sidecar/dist/awog-sidecar-<triple>
```

Before `pnpm tauri dev` will work, copy (or symlink) that artifact into this
directory. Example for Apple Silicon:

```bash
cp ../sidecar/dist/awog-sidecar-aarch64-apple-darwin ./
```

## TODO

Automate this step — candidates:

- A `beforeDevCommand` chain in `tauri.conf.json` that runs the sidecar build
  and copies the artifact.
- A small post-build script (`scripts/copy-sidecar.mjs`) invoked from the
  desktop package.

The binary itself is intentionally `.gitignore`d; only this README is tracked.

## `cargo check` requirement

Tauri's `build.rs` resolves `externalBin` paths at compile time and aborts if
the platform-specific file is missing. To run `cargo check` locally **before**
the sidecar is built, create an empty stub at the expected path, e.g.:

```bash
# macOS Apple Silicon
printf '#!/bin/sh\nexit 0\n' > apps/desktop/src-tauri/binaries/awog-sidecar-aarch64-apple-darwin
chmod +x apps/desktop/src-tauri/binaries/awog-sidecar-aarch64-apple-darwin
```

The stub is sufficient for compile-time checks; `tauri dev` will still need
the real sidecar produced by `pnpm --filter @awog/sidecar build`.
