import {
  AlertTriangle,
  CheckCircle2,
  ImagePlus,
  MessageSquareText,
  Send,
  ShieldAlert,
  Trash2,
  Upload,
  X
} from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent
} from "react";
import {
  FEEDBACK_MESSAGE_MAX_CHARACTERS,
  FEEDBACK_SCREENSHOT_MAX_COUNT,
  clampFeedbackMessage,
  countFeedbackCharacters,
  validateFeedbackEmail,
  validateFeedbackMessage,
  validateFeedbackScreenshotMetadata,
  type FeedbackEmailIssue,
  type FeedbackMessageIssue,
  type FeedbackScreenshotIssue,
  type FeedbackSubmitErrorCode,
  type FeedbackSubmitInput,
  type FeedbackSubmitResult
} from "../../shared/feedback";
import type { Translator } from "./i18n";

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])'
].join(",");

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) {
    return [];
  }
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector)).filter(
    (element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true"
  );
}

function trapFeedbackModalFocus(event: globalThis.KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== "Tab") {
    return;
  }
  const focusable = getFocusableElements(container);
  if (focusable.length === 0) {
    event.preventDefault();
    container?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function formatFeedbackFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(2)} MB`;
}

function feedbackMessageIssueText(t: Translator, issue: FeedbackMessageIssue): string {
  return issue === "required" ? t("feedbackMessageRequired") : t("feedbackMessageTooLong");
}

function feedbackEmailIssueText(t: Translator, issue: FeedbackEmailIssue): string {
  return issue === "tooLong" ? t("feedbackEmailTooLong") : t("feedbackEmailInvalid");
}

function feedbackScreenshotIssueText(t: Translator, issue: FeedbackScreenshotIssue): string {
  if (issue === "tooMany") {
    return t("feedbackScreenshotTooMany");
  }
  return issue === "tooLarge" ? t("feedbackScreenshotTooLarge") : t("feedbackScreenshotUnsupported");
}

function feedbackSubmitIssueText(t: Translator, issue: FeedbackSubmitErrorCode): string {
  if (issue === "unavailable") {
    return t("feedbackServiceUnavailable");
  }
  if (issue === "rateLimited") {
    return t("feedbackRateLimited");
  }
  if (issue === "timeout") {
    return t("feedbackTimeout");
  }
  if (issue === "network") {
    return t("feedbackNetworkError");
  }
  if (issue === "validation") {
    return t("feedbackValidationFailed");
  }
  return t("feedbackSubmitFailed");
}

export type FeedbackSubmitHandler = (input: FeedbackSubmitInput) => Promise<FeedbackSubmitResult>;

export function FeedbackEntryRow({
  t,
  onOpen
}: {
  t: Translator;
  onOpen: () => void;
}) {
  return (
    <div className="settings-row" id="settings-feedback">
      <div className="settings-row-icon" aria-hidden="true">
        <MessageSquareText size={21} />
      </div>
      <div className="settings-row-copy">
        <h3>{t("feedbackTitle")}</h3>
        <p>{t("feedbackDescription")}</p>
      </div>
      <div className="settings-row-actions settings-command-actions">
        <button
          className="primary-button settings-footer-action settings-feedback-action"
          type="button"
          onClick={onOpen}
        >
          <MessageSquareText size={16} />
          {t("openFeedback")}
        </button>
      </div>
    </div>
  );
}

export function FeedbackModal({
  t,
  onClose,
  onSubmit,
  initialScreenshots = []
}: {
  t: Translator;
  onClose: () => void;
  onSubmit: FeedbackSubmitHandler;
  initialScreenshots?: File[];
}) {
  const modalRef = useRef<HTMLElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isScreenshotPasteHoveredRef = useRef(false);
  const messageErrorId = useId();
  const emailErrorId = useId();
  const screenshotHelpId = useId();
  const screenshotErrorId = useId();
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [screenshots, setScreenshots] = useState<File[]>(
    initialScreenshots.slice(0, FEEDBACK_SCREENSHOT_MAX_COUNT)
  );
  const previewUrls = useMemo(
    () => screenshots.map((screenshot) => URL.createObjectURL(screenshot)),
    [screenshots]
  );
  const [messageIssue, setMessageIssue] = useState<FeedbackMessageIssue | null>(null);
  const [emailIssue, setEmailIssue] = useState<FeedbackEmailIssue | null>(null);
  const [screenshotIssue, setScreenshotIssue] = useState<FeedbackScreenshotIssue | null>(null);
  const [submitIssue, setSubmitIssue] = useState<FeedbackSubmitErrorCode | null>(null);
  const [isDraggingScreenshot, setIsDraggingScreenshot] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) {
        onClose();
        return;
      }
      trapFeedbackModalFocus(event, modalRef.current);
    };
    window.addEventListener("keydown", handleKeyDown);
    const focusFrame = window.requestAnimationFrame(() => messageRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
    };
  }, [isSubmitting, onClose]);

  useEffect(() => {
    return () => previewUrls.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
  }, [previewUrls]);

  const clearScreenshots = () => {
    setScreenshots([]);
    setScreenshotIssue(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const acceptScreenshots = (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    const validFiles: File[] = [];
    let nextIssue: FeedbackScreenshotIssue | null = null;
    for (const file of files) {
      const issue = validateFeedbackScreenshotMetadata({ type: file.type, size: file.size });
      if (issue) {
        nextIssue ??= issue;
      } else {
        validFiles.push(file);
      }
    }

    const availableSlots = Math.max(0, FEEDBACK_SCREENSHOT_MAX_COUNT - screenshots.length);
    const acceptedFiles = validFiles.slice(0, availableSlots);
    if (validFiles.length > availableSlots) {
      nextIssue = "tooMany";
    }
    if (acceptedFiles.length > 0) {
      setScreenshots((current) => [...current, ...acceptedFiles].slice(0, FEEDBACK_SCREENSHOT_MAX_COUNT));
    }
    setScreenshotIssue(nextIssue);
    setSubmitIssue(null);
  };

  const removeScreenshot = (index: number) => {
    setScreenshots((current) => current.filter((_, screenshotIndex) => screenshotIndex !== index));
    setScreenshotIssue(null);
    setSubmitIssue(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    if (!isScreenshotPasteHoveredRef.current) {
      return;
    }
    const imageFiles = Array.from(event.clipboardData.items)
      .filter(
      (item) => item.kind === "file" && item.type.startsWith("image/")
      )
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    if (imageFiles.length === 0) {
      return;
    }
    event.preventDefault();
    acceptScreenshots(imageFiles);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDraggingScreenshot(false);
    acceptScreenshots(Array.from(event.dataTransfer.files));
  };

  const resetForAnotherFeedback = () => {
    setMessage("");
    setEmail("");
    clearScreenshots();
    setMessageIssue(null);
    setEmailIssue(null);
    setSubmitIssue(null);
    setIsSubmitted(false);
    window.requestAnimationFrame(() => messageRef.current?.focus());
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextMessageIssue = validateFeedbackMessage(message);
    const nextEmailIssue = validateFeedbackEmail(email);
    setMessageIssue(nextMessageIssue);
    setEmailIssue(nextEmailIssue);
    setSubmitIssue(null);
    if (nextMessageIssue) {
      messageRef.current?.focus();
      return;
    }
    if (nextEmailIssue) {
      emailRef.current?.focus();
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        message: message.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(screenshots.length > 0
          ? {
              screenshots: await Promise.all(
                screenshots.map(async (screenshot) => ({
                  mimeType: screenshot.type,
                  data: await screenshot.arrayBuffer()
                }))
              )
            }
          : {})
      });
      if (!result.success) {
        setSubmitIssue(result.errorCode);
        return;
      }
      setMessage("");
      setEmail("");
      clearScreenshots();
      setIsSubmitted(true);
    } catch {
      setSubmitIssue("network");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop feedback-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <section
        ref={modalRef}
        className="form-modal feedback-modal"
        role="dialog"
        aria-modal="true"
        aria-label={t("feedbackModalTitle")}
        tabIndex={-1}
        onPaste={handlePaste}
      >
        <button
          className="icon-button feedback-modal-close"
          type="button"
          onClick={onClose}
          disabled={isSubmitting}
          aria-label={t("close")}
        >
          <X size={18} />
        </button>

        {isSubmitted ? (
          <div className="feedback-success-panel" role="status">
            <span className="feedback-success-icon" aria-hidden="true">
              <CheckCircle2 size={28} />
            </span>
            <h2>{t("feedbackSuccessTitle")}</h2>
            <p>{t("feedbackSuccessDescription")}</p>
            <div className="feedback-success-actions">
              <button className="secondary-button" type="button" onClick={onClose}>
                {t("close")}
              </button>
              <button className="primary-button" type="button" onClick={resetForAnotherFeedback}>
                <MessageSquareText size={16} />
                {t("feedbackSendAnother")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <header className="feedback-modal-intro">
              <span className="feedback-modal-emblem" aria-hidden="true">
                <MessageSquareText size={22} />
              </span>
              <h2>{t("feedbackModalTitle")}</h2>
              <p>{t("feedbackModalDescription")}</p>
            </header>

            <form className="feedback-form" onSubmit={handleSubmit} noValidate>
              <label className="feedback-field feedback-message-field">
                <span className="feedback-label-row">
                  <strong>{t("feedbackMessageLabel")}</strong>
                </span>
                <span className="feedback-textarea-wrap">
                  <textarea
                    ref={messageRef}
                    value={message}
                    aria-invalid={Boolean(messageIssue)}
                    aria-describedby={messageIssue ? messageErrorId : undefined}
                    required
                    placeholder={t("feedbackMessagePlaceholder")}
                    onChange={(event) => {
                      setMessage(clampFeedbackMessage(event.target.value));
                      setMessageIssue(null);
                      setSubmitIssue(null);
                    }}
                  />
                  <span className="feedback-character-count" aria-live="polite">
                    {countFeedbackCharacters(message)} / {FEEDBACK_MESSAGE_MAX_CHARACTERS}
                  </span>
                </span>
                {messageIssue && (
                  <span className="feedback-field-error" id={messageErrorId} role="alert">
                    <AlertTriangle size={14} />
                    {feedbackMessageIssueText(t, messageIssue)}
                  </span>
                )}
              </label>

              <label className="feedback-field">
                <span className="feedback-label-row">
                  <strong>{t("feedbackEmailLabel")}</strong>
                  <span className="feedback-optional">{t("feedbackOptional")}</span>
                </span>
                <input
                  ref={emailRef}
                  type="email"
                  value={email}
                  aria-invalid={Boolean(emailIssue)}
                  aria-describedby={emailIssue ? emailErrorId : undefined}
                  autoComplete="email"
                  placeholder={t("feedbackEmailPlaceholder")}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setEmailIssue(null);
                    setSubmitIssue(null);
                  }}
                />
                {emailIssue && (
                  <span className="feedback-field-error" id={emailErrorId} role="alert">
                    <AlertTriangle size={14} />
                    {feedbackEmailIssueText(t, emailIssue)}
                  </span>
                )}
              </label>

              <div className="feedback-field">
                <span className="feedback-label-row">
                  <strong>{t("feedbackScreenshotLabel")}</strong>
                  <span className="feedback-optional">{t("feedbackOptional")}</span>
                  <span className="feedback-screenshot-count" aria-live="polite">
                    {screenshots.length} / {FEEDBACK_SCREENSHOT_MAX_COUNT}
                  </span>
                </span>
                <input
                  ref={fileInputRef}
                  className="feedback-file-input"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  multiple
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    acceptScreenshots(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />

                {screenshots.length > 0 && (
                  <div
                    className={`feedback-screenshot-list${isDraggingScreenshot ? " is-dragging" : ""}`}
                    onMouseEnter={() => {
                      isScreenshotPasteHoveredRef.current = true;
                    }}
                    onMouseLeave={() => {
                      isScreenshotPasteHoveredRef.current = false;
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDraggingScreenshot(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setIsDraggingScreenshot(false);
                      }
                    }}
                    onDrop={handleDrop}
                  >
                    {screenshots.map((screenshot, index) => {
                      const previewUrl = previewUrls[index];
                      return previewUrl ? (
                        <div
                          className="feedback-screenshot-preview"
                          key={`${screenshot.name}-${screenshot.lastModified}-${screenshot.size}-${index}`}
                        >
                          <img
                            src={previewUrl}
                            alt={`${t("feedbackScreenshotPreviewAlt")} ${index + 1}`}
                          />
                          <button
                            className="icon-button feedback-remove-screenshot"
                            type="button"
                            onClick={() => removeScreenshot(index)}
                            aria-label={`${t("feedbackRemoveScreenshot")} ${index + 1}`}
                            title={t("feedbackRemoveScreenshot")}
                          >
                            <Trash2 size={14} />
                          </button>
                          <div className="feedback-screenshot-meta">
                            <strong title={screenshot.name}>{screenshot.name}</strong>
                            <span>{formatFeedbackFileSize(screenshot.size)}</span>
                          </div>
                        </div>
                      ) : null;
                    })}
                    {screenshots.length < FEEDBACK_SCREENSHOT_MAX_COUNT && (
                      <button
                        className="feedback-add-screenshot-card"
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <ImagePlus size={20} />
                        <span>{t("feedbackAddScreenshot")}</span>
                      </button>
                    )}
                  </div>
                )}

                {screenshots.length === 0 && (
                  <div
                    className={`feedback-drop-zone${isDraggingScreenshot ? " is-dragging" : ""}`}
                    onMouseEnter={() => {
                      isScreenshotPasteHoveredRef.current = true;
                    }}
                    onMouseLeave={() => {
                      isScreenshotPasteHoveredRef.current = false;
                    }}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsDraggingScreenshot(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                        setIsDraggingScreenshot(false);
                      }
                    }}
                    onDrop={handleDrop}
                  >
                    <span className="feedback-drop-icon" aria-hidden="true">
                      {isDraggingScreenshot ? <Upload size={22} /> : <ImagePlus size={22} />}
                    </span>
                    <div className="feedback-drop-copy">
                      <strong>
                        {isDraggingScreenshot ? t("feedbackDropActive") : t("feedbackDropTitle")}
                      </strong>
                      <span>{t("feedbackDropDescription")}</span>
                    </div>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {t("feedbackChooseScreenshot")}
                    </button>
                  </div>
                )}

                <span className="feedback-screenshot-help" id={screenshotHelpId}>
                  {t("feedbackScreenshotHelp")}
                </span>
                {screenshotIssue && (
                  <span className="feedback-field-error" id={screenshotErrorId} role="alert">
                    <AlertTriangle size={14} />
                    {feedbackScreenshotIssueText(t, screenshotIssue)}
                  </span>
                )}
              </div>

              <div className="feedback-privacy-note">
                <ShieldAlert size={17} aria-hidden="true" />
                <p>{t("feedbackPrivacyNotice")}</p>
              </div>

              {submitIssue && (
                <div className="inline-message error feedback-submit-error" role="alert">
                  {feedbackSubmitIssueText(t, submitIssue)}
                </div>
              )}

              <div className="feedback-form-actions">
                <button className="primary-button feedback-submit-button" type="submit" disabled={isSubmitting}>
                  {isSubmitting ? <span className="feedback-submit-spinner" aria-hidden="true" /> : <Send size={16} />}
                  {isSubmitting ? t("feedbackSubmitting") : t("feedbackSubmit")}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
