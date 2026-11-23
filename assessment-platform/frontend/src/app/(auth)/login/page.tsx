import type { Metadata } from 'next';
import { Check, CodeXml, ShieldCheck, Sparkles, Terminal } from 'lucide-react';
import { AuthHeader } from '@/components/auth-header';
import { LoginForm } from '@/features/auth/login-form';
export const metadata: Metadata = { title: 'Student sign in' };
export default function LoginPage() {
  return (
    <main className="login-page">
      <AuthHeader />
      <section className="login-story" aria-label="About RedResume Assessment">
        <div className="story-main">
          <span className="eyebrow story-eyebrow">
            <Sparkles size={14} aria-hidden="true" />
            REDRESUME ASSESSMENT
          </span>
          <h1>
            Your skills.
            <br />
            <span>Your next opportunity.</span>
          </h1>
          <p>
            Take coding assessments, solve meaningful problems, and show what you can build. Your
            next chapter starts with RedResumes.
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
        <p className="story-foot">Built for your next chapter. Powered by RedResumes.</p>
      </section>
      <section className="login-panel">
        <div className="login-content">
          <span className="eyebrow">STUDENT WORKSPACE</span>
          <h2>Welcome back.</h2>
          <p className="login-subtitle">Sign in to your RedResume assessment workspace.</p>
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
