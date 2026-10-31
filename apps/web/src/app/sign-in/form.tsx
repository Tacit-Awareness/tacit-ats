function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.2c0-.8-.1-1.5-.2-2.2H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8.1z" />
      <path fill="#34A853" d="M12 23c3 0 5.4-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.1-3.1A11 11 0 0 0 2.2 7.1L5.8 10c.9-2.7 3.3-4.6 6.2-4.6z" />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path fill="#F25022" d="M2 2h9.5v9.5H2z" />
      <path fill="#7FBA00" d="M12.5 2H22v9.5h-9.5z" />
      <path fill="#00A4EF" d="M2 12.5h9.5V22H2z" />
      <path fill="#FFB900" d="M12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

/** One form, so it works with no script: the button pressed names the method. */
export function SignInForm({ next }: { next: string }) {
  return (
    <>
      <h1>Sign in</h1>
      <p className="sign-in-sub">Use the account your company invited.</p>
      <form className="sign-in-methods" action="/sign-in/start" method="post">
        <input type="hidden" name="next" value={next} />
        <button className="sign-in-btn" name="method" value="google">
          <GoogleIcon />
          Continue with Google
        </button>
        <button className="sign-in-btn" name="method" value="microsoft">
          <MicrosoftIcon />
          Continue with Microsoft
        </button>
        <button className="sign-in-link" name="method" value="hosted">
          Use email instead
        </button>
      </form>
    </>
  );
}
