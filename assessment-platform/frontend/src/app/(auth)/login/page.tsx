import type { Metadata } from 'next';
import { ArrowUpRight, Check, CodeXml, ShieldCheck, Terminal } from 'lucide-react';
import { PlatformLogo } from '@/components/platform-logo';
import { LoginForm } from '@/features/auth/login-form';
export const metadata: Metadata = { title: 'Student sign in' };
export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="login-story" aria-label="About CodeBench">
        <PlatformLogo light />
        <div className="story-main">
          <span className="eyebrow story-eyebrow">
            <span className="status-dot" />
            YOUR NEXT CHALLENGE STARTS HERE
          </span>
          <h1>
            Good thinking.
            <br />
            <span>Great possibilities.</span>
          </h1>
          <p>
            A focused space to solve meaningful problems
            <br className="desktop-break" /> and show what you can build.
          </p>
          <div className="code-window" aria-hidden="true">
            <div className="code-window-bar">
              <div>
                <i />
                <i />
                <i />
              </div>
              <span>your-next-chapter.py</span>
              <Terminal size={15} />
            </div>
            <div className="code-lines">
              <span className="line-number">01</span>
              <code>
                <em>def</em> <strong>find_your_potential</strong>():
              </code>
              <span className="line-number">02</span>
              <code>
                {' '}
                curiosity = <b>True</b>
              </code>
              <span className="line-number">03</span>
              <code>
                {' '}
                <em>while</em> curiosity:
              </code>
              <span className="line-number">04</span>
              <code>
                {' '}
                learn<span className="code-muted">()</span>
              </code>
              <span className="line-number">05</span>
              <code>
                {' '}
                solve<span className="code-muted">()</span>
              </code>
              <span className="line-number">06</span>
              <code>
                {' '}
                grow<span className="code-muted">()</span>
              </code>
            </div>
            <div className="code-window-footer">
              <span>
                <Check size={13} />
                Ready for what&apos;s next
              </span>
              <ArrowUpRight size={16} />
            </div>
          </div>
          <div className="story-tags">
            <span>
              <CodeXml size={16} />
              Python · Java · C++
            </span>
            <span>
              <ShieldCheck size={16} />
              Secure assessments
            </span>
          </div>
        </div>
        <p className="story-foot">THINK CLEARLY. BUILD CONFIDENTLY.</p>
      </section>
      <section className="login-panel">
        <div className="mobile-logo">
          <PlatformLogo />
        </div>
        <div className="login-content">
          <span className="eyebrow">STUDENT WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p className="login-subtitle">Your next opportunity is one sign-in away.</p>
          <LoginForm />
        </div>
        <div className="login-panel-foot">
          <ShieldCheck size={15} />
          Secure, private and built for your focus.
        </div>
      </section>
    </main>
  );
}
