import { Braces } from 'lucide-react';
export function PlatformLogo({ light = false }: { light?: boolean }) {
  return (
    <span className={`platform-logo ${light ? 'platform-logo-light' : ''}`}>
      <span className="logo-mark" aria-hidden="true">
        <Braces size={23} strokeWidth={2.6} />
      </span>
      <span>
        CodeBench<span className="logo-dot">.</span>
      </span>
    </span>
  );
}
