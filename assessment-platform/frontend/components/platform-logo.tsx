export function PlatformLogo({
  light = false,
  admin = false,
}: {
  light?: boolean;
  admin?: boolean;
}) {
  return (
    <span className={`platform-logo ${light ? 'platform-logo-light' : ''}`}>
      <span>RedResumes</span>
      <small>{admin ? 'Assessment · Admin' : 'Assessment'}</small>
    </span>
  );
}
