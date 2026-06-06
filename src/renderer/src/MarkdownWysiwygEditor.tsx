import Editor from "@toast-ui/editor";
import "@toast-ui/editor/dist/toastui-editor.css";
import "@toast-ui/editor/dist/theme/toastui-editor-dark.css";
import "@toast-ui/editor/dist/i18n/zh-cn";
import "@toast-ui/editor/dist/i18n/zh-tw";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LanguagePreference } from "../../shared/types";

type EditorTheme = "light" | "dark";

interface MarkdownWysiwygEditorProps {
  value: string;
  language: LanguagePreference;
  theme: EditorTheme;
  placeholder: string;
  height?: string;
  minHeight?: string;
  disabled?: boolean;
  compact?: boolean;
  hideModeSwitch?: boolean;
  onChange: (value: string) => void;
  onImageUpload?: (file: File | Blob) => Promise<string>;
  onImageError?: (error: unknown) => void;
}

function editorLanguage(language: LanguagePreference): string {
  if (language === "zh-TW") {
    return "zh-TW";
  }
  if (language === "en") {
    return "en-US";
  }
  return "zh-CN";
}

export function MarkdownWysiwygEditor({
  value,
  language,
  theme,
  placeholder,
  height = "620px",
  minHeight = "360px",
  disabled = false,
  compact = false,
  hideModeSwitch = true,
  onChange,
  onImageUpload,
  onImageError
}: MarkdownWysiwygEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<Editor | null>(null);
  const latestValueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onImageUploadRef = useRef(onImageUpload);
  const onImageErrorRef = useRef(onImageError);
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onImageUploadRef.current = onImageUpload;
  }, [onImageUpload]);

  useEffect(() => {
    onImageErrorRef.current = onImageError;
  }, [onImageError]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const editor = new Editor({
      el: host,
      height,
      minHeight,
      initialValue: value,
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      language: editorLanguage(language),
      theme: theme === "dark" ? "dark" : "default",
      placeholder,
      autofocus: false,
      useCommandShortcut: true,
      usageStatistics: false,
      hideModeSwitch,
      toolbarItems: [],
      events: {
        change: () => {
          const markdown = editor.getMarkdown();
          latestValueRef.current = markdown;
          onChangeRef.current(markdown);
        }
      },
      hooks: {
        addImageBlobHook: (blob, callback) => {
          const upload = onImageUploadRef.current;
          if (!upload) {
            callback("", "image");
            return false;
          }
          upload(blob)
            .then((url) => {
              callback(url, "image");
            })
            .catch((error) => {
              onImageErrorRef.current?.(error);
            });
          return false;
        }
      }
    });

    editorRef.current = editor;

    if (disabled) {
      editor.blur();
      host.classList.add("editor-disabled");
    }

    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [compact, disabled, height, language, minHeight, placeholder, theme]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    if (value !== editor.getMarkdown()) {
      editor.setMarkdown(value, false);
    }
    latestValueRef.current = value;
  }, [value]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const handlePaste = (event: ClipboardEvent) => {
      if (disabled) {
        return;
      }
      const editor = editorRef.current;
      const clipboardData = event.clipboardData;
      if (!editor || !clipboardData) {
        return;
      }
      const hasFilePayload =
        clipboardData.files.length > 0 || Array.from(clipboardData.items).some((item) => item.kind === "file");
      if (hasFilePayload) {
        return;
      }
      const plainText = clipboardData.getData("text/plain");
      const normalizedText = plainText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
      if (!normalizedText.includes("\n")) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      editor.replaceSelection(normalizedText);
      const markdown = editor.getMarkdown();
      latestValueRef.current = markdown;
      onChangeRef.current(markdown);
    };

    host.addEventListener("paste", handlePaste, true);
    return () => {
      host.removeEventListener("paste", handlePaste, true);
    };
  }, [disabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    host.classList.toggle("editor-disabled", disabled);
  }, [disabled]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const handleClick = (event: MouseEvent) => {
      if (!(event.target instanceof HTMLImageElement)) {
        return;
      }
      const src = event.target.currentSrc || event.target.src;
      if (!src) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setPreviewImage({ src, alt: event.target.alt || "image" });
    };

    host.addEventListener("click", handleClick, true);
    return () => {
      host.removeEventListener("click", handleClick, true);
    };
  }, []);

  useEffect(() => {
    if (!previewImage) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewImage(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [previewImage]);

  const lightbox = previewImage
    ? createPortal(
        <div className="image-lightbox-backdrop" role="presentation" onClick={() => setPreviewImage(null)}>
          <section
            className="image-lightbox"
            role="dialog"
            aria-modal="true"
            aria-label="Image preview"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="icon-button image-lightbox-close"
              type="button"
              aria-label="Close image preview"
              onClick={() => setPreviewImage(null)}
            >
              <X size={20} />
            </button>
            <img src={previewImage.src} alt={previewImage.alt} />
          </section>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <div className={`markdown-wysiwyg-editor ${compact ? "compact" : ""}`} ref={hostRef} />
      {lightbox}
    </>
  );
}
