import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeSlug from "rehype-slug";
import remarkGfm from "remark-gfm";

import type { DocumentPayload } from "./types";
import {
  buildAssetUrl,
  formatTimestamp,
  resolveAssetSource,
  resolveDocumentHref
} from "./utils";

const markdownSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), "href", "rel", "target", "title"],
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-/, /^hljs/]
    ],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title"],
    pre: [...(defaultSchema.attributes?.pre ?? []), ["className", /^hljs/]],
    span: [...(defaultSchema.attributes?.span ?? []), ["className", /^hljs/]]
  }
};

interface MarkdownDocumentProps {
  document: DocumentPayload;
  pendingHash: string | null;
  onOpenDocument: (path: string, hash: string) => void;
  onHashHandled: () => void;
}

export function MarkdownDocument(props: MarkdownDocumentProps) {
  const containerReference = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!props.pendingHash) {
      return;
    }

    const hash = decodeURIComponent(props.pendingHash.replace(/^#/, ""));

    requestAnimationFrame(() => {
      const target =
        containerReference.current?.querySelector<HTMLElement>(`#${escapeSelector(hash)}`) ?? null;

      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }

      props.onHashHandled();
    });
  }, [props.document.content, props.document.path, props.onHashHandled, props.pendingHash]);

  return (
    <div className="document-shell" ref={containerReference}>
      <div className="document-meta">
        <span>{props.document.path}</span>
        <span>Updated {formatTimestamp(props.document.updatedAt)}</span>
      </div>

      <article className="markdown-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[[rehypeSanitize, markdownSchema], rehypeSlug, rehypeHighlight]}
          components={{
            a: ({ href = "", children, ...anchorProps }) => {
              const resolvedDocument = resolveDocumentHref(props.document.path, href);

              if (resolvedDocument) {
                return (
                  <a
                    {...anchorProps}
                    href={href}
                    onClick={(event) => {
                      event.preventDefault();
                      props.onOpenDocument(resolvedDocument.path, resolvedDocument.hash);
                    }}
                  >
                    {children}
                  </a>
                );
              }

              const isExternal = /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/)/.test(href);

              return (
                <a
                  {...anchorProps}
                  href={href}
                  rel={isExternal ? "noreferrer" : anchorProps.rel}
                  target={isExternal ? "_blank" : anchorProps.target}
                >
                  {children}
                </a>
              );
            },
            img: ({ src = "", alt = "", ...imageProps }) => {
              const resolvedSource = resolveAssetSource(props.document.path, src);
              const isExternal = /^(?:[a-zA-Z][a-zA-Z\d+\-.]*:|\/\/|data:)/.test(src);

              return (
                <img
                  {...imageProps}
                  src={resolvedSource ? buildAssetUrl(resolvedSource) : src}
                  alt={alt}
                  loading="lazy"
                  referrerPolicy={isExternal ? "no-referrer" : undefined}
                />
              );
            }
          }}
        >
          {props.document.content}
        </ReactMarkdown>
      </article>
    </div>
  );
}

function escapeSelector(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}
