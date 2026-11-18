import { ApiError } from '../api';

// Shows an API problem (title, detail and any field errors) or an unexpected error, inline where it happened.
export function ErrorMessage({ error }: { error: unknown }) {
  if (!error) return null;

  if (!(error instanceof ApiError)) {
    return (
      <p role="alert" className="error">
        Something went wrong. Check your connection and try again.
      </p>
    );
  }

  // The API or the gateway in front of it is briefly down (cold start, database waking up, a deploy). That isn't
  // the user's fault and needs no action from them, so say so plainly instead of showing the raw status.
  if (error.status === 502 || error.status === 503 || error.status === 504) {
    return (
      <p role="alert" className="error">
        The service is temporarily unavailable. Please try again in a moment.
      </p>
    );
  }

  return (
    <div role="alert" className="error">
      <strong>{error.title}</strong>
      {error.detail && <span> {error.detail}</span>}
      {error.fieldErrors.length > 0 && (
        <ul>
          {error.fieldErrors.map((fieldError) => (
            <li key={fieldError.path + fieldError.message}>
              {fieldError.path && <code>{fieldError.path}</code>} {fieldError.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
