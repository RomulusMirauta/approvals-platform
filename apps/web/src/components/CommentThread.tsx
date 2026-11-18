import type { Comment } from '@approvals/contracts';
import { useState, type FormEvent } from 'react';
import { formatDateTime } from '../format';
import { useAddComment } from '../queries';
import { ErrorMessage } from './ErrorMessage';

export function CommentThread({ requestId, comments }: { requestId: string; comments: Comment[] }) {
  const addComment = useAddComment(requestId);
  const [body, setBody] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    addComment.mutate(body.trim(), { onSuccess: () => setBody('') });
  }

  return (
    <section>
      <h3>Comments</h3>
      {comments.length === 0 ? (
        <p className="muted">No comments yet.</p>
      ) : (
        <ul className="timeline">
          {comments.map((comment) => (
            <li key={comment.id}>
              <strong>{comment.author.name}</strong> <span className="muted">{formatDateTime(comment.createdAt)}</span>
              <p>{comment.body}</p>
            </li>
          ))}
        </ul>
      )}

      <form className="comment-form" onSubmit={submit}>
        <label htmlFor="new-comment">Add a comment</label>
        <textarea id="new-comment" rows={2} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} />
        <ErrorMessage error={addComment.error} />
        <button type="submit" className="button" disabled={addComment.isPending || body.trim() === ''}>
          Comment
        </button>
      </form>
    </section>
  );
}
