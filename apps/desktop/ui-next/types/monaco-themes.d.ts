// Type shim for the `monaco-themes` data-only package (ADR 0053). Each theme is a
// JSON file shaped like Monaco's IStandaloneThemeData, loaded via dynamic import in
// useMonacoTheme. Declared as a self-contained ambient wildcard module (no
// top-level import — that would make this a module and break the ambient
// declaration). The structural shape matches editor.IStandaloneThemeData exactly,
// so the import is usable with monaco.editor.defineTheme without a cast.
declare module 'monaco-themes/themes/*.json' {
  const data: {
    base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
    inherit: boolean
    rules: {
      token: string
      foreground?: string
      background?: string
      fontStyle?: string
    }[]
    colors: { [colorId: string]: string }
    encodedTokensColors?: string[]
  }
  export default data
}
