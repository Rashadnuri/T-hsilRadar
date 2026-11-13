// The real <html>/<body> live in app/[locale]/layout.tsx so that the `lang` attribute
// can follow the active locale. This root layout is intentionally a pass-through.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
