import Link from 'next/link';
import { PlatformLogo } from '@/components/platform-logo';

export function AuthHeader() {
  return (
    <header className="auth-header">
      <div className="auth-header-inner">
        <Link href="/" aria-label="RedResume Assessment home">
          <PlatformLogo />
        </Link>
        <nav aria-label="Assessment navigation">
          <a href="https://redresumes.com/">RedResumes.com</a>
          <span className="auth-access">Student access</span>
        </nav>
      </div>
    </header>
  );
}
