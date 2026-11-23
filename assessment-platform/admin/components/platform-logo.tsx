export function PlatformLogo({ admin = true }: { admin?: boolean }) {
  return (
    <span className="platform-logo">
      <span>RedResumes</span>
      <small>{admin ? 'Assessment · Admin' : 'Assessment'}</small>
    </span>
  );
}
