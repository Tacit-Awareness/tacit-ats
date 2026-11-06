import { Ico, ICON } from "@/components/careers/frame";
import { Marked } from "@/components/marked";
import { formSections, questionLabel } from "@/lib/public/application";
import { VIA, type Channel } from "@/lib/public/channel";
import { ANSWER_PREFIX, DECLINE, EEOC_PREFIX, EEOC_QUESTIONS, HONEYPOT_FIELD, RESUME_FIELD, type PublicQuestion } from "@/lib/public/jobs";
import { RESUME_ACCEPT, RESUME_TYPES_WORDS } from "@/lib/resume-file";
import { APPLY_FORM } from "./guide";

// The application (design/careers), one form that posts with no script: the
// browser's own required / maxLength / type checks first, then the route. Each
// answer's field is a_<question id>. The resume is a file, posted with the
// rest as multipart (the route checks and stores it). The prototype's resume
// reading, note writer, consent box and undo have nothing behind them yet.

export const answerField = (q: PublicQuestion) => `${ANSWER_PREFIX}${q.id}`;

function Label({ q }: { q: PublicQuestion }) {
  return (
    <>
      <Marked text={questionLabel(q)} />
      {q.required ? <span className="req"> *</span> : null}
    </>
  );
}

/**
 * design/careers' drop box, around the browser's own file input, so it works
 * with no script: the input takes a dropped file and names the one picked.
 */
function ResumeDrop({ q }: { q: PublicQuestion }) {
  return (
    <label className="field">
      <span className="lbl">
        <Label q={q} />
      </span>
      <span className="drop">
        <Ico d={ICON.file} />
        <b>Drop your resume or browse</b>
        <small>{RESUME_TYPES_WORDS}, up to 3 MB</small>
        <input className="drop-input" type="file" name={RESUME_FIELD} accept={RESUME_ACCEPT} required={q.required} />
      </span>
    </label>
  );
}

function Question({ q }: { q: PublicQuestion }) {
  const name = answerField(q);
  if (q.type === "resume") return <ResumeDrop q={q} />;
  if (q.type === "yes_no") {
    return (
      <fieldset className="field">
        <legend className="lbl">
          <Label q={q} />
        </legend>
        <div className="yn">
          {["yes", "no"].map((v) => (
            <label key={v}>
              <input type="radio" name={name} value={v} required={q.required} />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  let input: React.ReactNode;
  if (q.type === "long_text") {
    input = <textarea className="input" name={name} required={q.required} maxLength={5000} rows={6} />;
  } else if (q.type === "select") {
    input = (
      <select className="input" name={name} required={q.required} defaultValue="">
        <option value="">Choose…</option>
        {(q.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  } else {
    const kind = {
      name: { type: "text", maxLength: 200, autoComplete: "name" },
      email: { type: "email", maxLength: 254, autoComplete: "email" },
      phone: { type: "tel", maxLength: 40, autoComplete: "tel" },
      linkedin: { type: "url", maxLength: 300, placeholder: "https://www.linkedin.com/in/…" },
      short_text: { type: "text", maxLength: 300 },
    }[q.type];
    input = <input className="input" name={name} required={q.required} {...kind} />;
  }
  return (
    <label className="field">
      <span className="lbl">
        <Label q={q} />
      </span>
      {input}
    </label>
  );
}

export function ApplicationForm({ slug, company, questions, notice, channel }: { slug: string; company: string; questions: PublicQuestion[]; notice: string | null; channel: Channel }) {
  const { resume, about, custom } = formSections(questions);
  return (
    <form id={APPLY_FORM} className="form" method="post" encType="multipart/form-data" action={`/api/jobs/${slug}/apply?${VIA}=${channel}`}>
      {notice ? (
        <p className="notice" role="alert">
          {notice}
        </p>
      ) : null}
      {resume.length > 0 ? (
        <div className="sec">
          <h2 className="sec-title">Resume</h2>
          <div className="stack">
            {resume.map((q) => (
              <Question key={q.id} q={q} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="sec">
        <h2 className="sec-title">About you</h2>
        <div className="grid2">
          {about.map((q) => (
            <Question key={q.id} q={q} />
          ))}
        </div>
      </div>
      {custom.length > 0 ? (
        <div className="sec">
          <h2 className="sec-title">Questions</h2>
          <div className="stack">
            {custom.map((q) => (
              <Question key={q.id} q={q} />
            ))}
          </div>
        </div>
      ) : null}
      {/* Voluntary EEO self-identification, apart from the application's questions. */}
      <div className="sec">
        <details className="eeo">
          <summary>
            Voluntary self-identification <span className="req">Optional</span>
            <Ico d={ICON.chev} />
          </summary>
          <p className="sec-sub">
            {company} invites applicants to self-identify for equal employment opportunity reporting. Answering is optional and does not affect
            your application: the hiring team never sees your answers, which are only counted in anonymous totals. Leave any question at
            &ldquo;I decline to self-identify&rdquo;.
          </p>
          <div className="grid2">
            {EEOC_QUESTIONS.map((q) => (
              <label key={q.key} className="field">
                <span className="lbl">{q.label}</span>
                <select className="input" name={`${EEOC_PREFIX}${q.key}`} defaultValue={DECLINE}>
                  {q.options.map(([value, text]) => (
                    <option key={value} value={value}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        </details>
      </div>
      {/* For bots only: hidden from people and from assistive tech. */}
      <div aria-hidden className="trap">
        <label>
          Website
          <input type="text" name={HONEYPOT_FIELD} tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <div className="sec">
        <button type="submit" className="btn dark">
          Submit application
        </button>
      </div>
    </form>
  );
}
